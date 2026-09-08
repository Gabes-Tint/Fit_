import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	APP_PORT,
	APP_ROOT,
	CURRENT_LINK,
	deployHost,
	ENV_FILE,
	NODE_ROOT,
	pinnedNodeVersion,
	PUBLIC_ORIGIN,
	RELEASES_KEPT,
	RELEASES_ROOT,
	remote,
	REMOTE_NODE,
	SERVICE_NAME,
	SERVICE_USER,
	SSH_OPTIONS,
	STATE_DIRECTORY,
	templateDirectory,
	UNIT_FILE
} from './config';
import { activationScript } from './activation';
import { assertMainCiGreen } from './main-ci-gate';
import { currentReleaseVersion } from './release-version';
import { activateAndPrune, describeActivationFailure } from './rollout';
import { ASSET_GENERATIONS, pruneReleasesScript, retainAssetsScript } from './retention';
import { smoke } from './smoke';
import { capture, projectRoot, run } from '../security/shared';

/**
 * One release of Fit_ onto the machine `FIT_DEPLOY_HOST` names.
 *
 * The build runs here, not there: the VM has 2 GB of memory and Vite does not
 * fit in it beside the running server. What crosses is the `adapter-node`
 * output, the `package.json` beside it — Node needs its `"type": "module"` to
 * read the bundle as ESM — and a production `node_modules`, because
 * adapter-node leaves every `dependencies` entry external by design and the
 * server bundle really does import one of them.
 *
 * A release directory is named for its commit, the symlink switch is the
 * deploy, and the restart is what picks it up.
 */

const NODE_ARCHIVES = 'https://nodejs.org/dist';

/** Where the production dependency tree is assembled, under the ignored reports directory. */
const STAGING = path.join(projectRoot, 'reports', 'deploy', 'runtime');

/** What a release directory holds, and what each `rsync` pass owns exclusively. */
const SHIPPED_DIRECTORIES = ['build', 'node_modules'] as const;

type Options = { tunnel: boolean };

function parseOptions(argv: string[]): Options {
	const unknown = argv.filter((argument) => argument !== '--tunnel');
	if (unknown.length > 0) throw new Error(`unexpected argument ${unknown[0] ?? ''}`);
	return { tunnel: argv.includes('--tunnel') };
}

/**
 * The commit this release is named for.
 *
 * A dirty tree is refused rather than labelled: the smoke check asserts that
 * the live release is `HEAD`, and a release that is not what its name says
 * makes that assertion a lie for every deploy after it.
 */
async function releaseCommit(): Promise<string> {
	if ((await capture('git', ['status', '--porcelain'])) !== '') {
		throw new Error(
			'the working tree has uncommitted changes; a release is named for its commit, so commit or stash first'
		);
	}
	return capture('git', ['rev-parse', 'HEAD']);
}

/**
 * The production dependency tree, resolved from the lockfile this repository
 * already reviews rather than from a second one generated for the occasion.
 *
 * It is assembled in its own directory because `bun install --production` in
 * the project would delete the devDependencies every gate needs.
 */
async function stageRuntimeDependencies(): Promise<void> {
	await mkdir(STAGING, { recursive: true });
	for (const file of ['package.json', 'bun.lock']) {
		await writeFile(path.join(STAGING, file), readFileSync(path.join(projectRoot, file)));
	}
	await run('bun', ['install', '--production', '--frozen-lockfile'], { cwd: STAGING });
}

/**
 * The pinned runtime, from nodejs.org against its own `SHASUMS256.txt`: no
 * third-party repository decides which build of it this machine runs.
 */
async function installNode(version: string): Promise<void> {
	const architecture = (await remote('uname -m')).trim() === 'aarch64' ? 'arm64' : 'x64';
	const archive = `node-v${version}-linux-${architecture}`;
	await remote(`
if [ "$(${REMOTE_NODE} -v 2>/dev/null || true)" = "v${version}" ]; then exit 0; fi
work=$(mktemp -d)
cd "$work"
curl -fsSLO ${NODE_ARCHIVES}/v${version}/${archive}.tar.xz
curl -fsSLO ${NODE_ARCHIVES}/v${version}/SHASUMS256.txt
grep " ${archive}.tar.xz\\$" SHASUMS256.txt | sha256sum -c -
rm -rf ${NODE_ROOT}-v${version}
mkdir -p ${NODE_ROOT}-v${version}
tar -xJf ${archive}.tar.xz -C ${NODE_ROOT}-v${version} --strip-components=1
ln -sfnT ${NODE_ROOT}-v${version} ${NODE_ROOT}
cd /
rm -rf "$work"
`);
}

/** The user, the directories, and the pinned runtime. Safe to re-run; nothing here is destructive. */
async function prepareMachine(version: string): Promise<void> {
	await remote(`
id ${SERVICE_USER} >/dev/null 2>&1 ||
	useradd --system --create-home --home-dir ${APP_ROOT} --shell /usr/sbin/nologin ${SERVICE_USER}
install -d -o root -g root -m 0755 ${APP_ROOT} ${RELEASES_ROOT} ${path.dirname(ENV_FILE)}
install -d -o ${SERVICE_USER} -g ${SERVICE_USER} -m 0700 ${STATE_DIRECTORY}
`);
	await installNode(version);
}

/**
 * One `rsync` pass per directory, rather than several sources into one
 * destination: `--delete` is scoped to the directory being transferred, and
 * with several sources it would delete each of them in turn.
 *
 * `--link-dest` at the previous release makes the parts that did not change —
 * most of `node_modules` — hard links rather than a second copy, so keeping
 * several releases costs the disk once. Ownership is deliberately not carried
 * across: `--archive` would ask for the local user's ids, which no release on
 * the machine has, and `--link-dest` refuses to link a file whose attributes
 * differ — so preserving them would silently copy `node_modules` every time.
 */
async function rsyncTo(
	source: string,
	destination: string,
	linkDest: string | null
): Promise<void> {
	await run('rsync', [
		'--archive',
		'--no-owner',
		'--no-group',
		'--delete',
		'--compress',
		'--rsync-path=sudo rsync',
		'--rsh',
		['ssh', ...SSH_OPTIONS].join(' '),
		...(linkDest === null ? [] : ['--link-dest', linkDest]),
		source,
		`${deployHost()}:${destination}`
	]);
}

/**
 * The release `current` points at, or `null` when nothing is live yet.
 *
 * Read before anything is shipped, because it is both what `--link-dest`
 * reuses and what a failed activation goes back to, and after the switch it is
 * no longer readable from the machine.
 */
async function liveRelease(): Promise<string | null> {
	const live = (await remote(`readlink -f ${CURRENT_LINK} 2>/dev/null || true`)).trim();
	return live === '' ? null : live;
}

async function shipRelease(release: string, previous: string | null): Promise<void> {
	const target = `${RELEASES_ROOT}/${release}`;
	await remote(`install -d -o root -g root -m 0755 ${target}`);
	const reusable = previous === null || previous === target ? null : previous;
	for (const directory of SHIPPED_DIRECTORIES) {
		const source = directory === 'build' ? projectRoot : STAGING;
		await rsyncTo(
			`${path.join(source, directory)}/`,
			`${target}/${directory}/`,
			reusable === null ? null : `${reusable}/${directory}/`
		);
	}
	await rsyncTo(path.join(projectRoot, 'package.json'), `${target}/package.json`, null);
}

function template(name: string): string {
	return readFileSync(path.join(templateDirectory, name), 'utf8');
}

/** Who owns a template's copy on the machine. A test installs as itself instead. */
const ROOT_OWNED = 'root:root';

/**
 * A file written on the machine byte for byte, without a heredoc's opinions
 * about `$`.
 *
 * Staged beside its destination and renamed over it, rather than piped into
 * `install /dev/stdin`: Ubuntu 26.04 ships uutils coreutils rather than GNU,
 * and its `install` reads a source it can name — so `/dev/stdin` worked on a
 * machine that had never been deployed to and failed with `ENOENT` on every
 * deploy after, which is a failure no first deploy can show you. The rename
 * also makes replacing the live unit atomic, which the pipe never was.
 *
 * It is one parenthesised group because the caller puts it on the right of
 * `||`, where a bare `&&` chain would run its tail regardless of the test.
 * The group is also what scopes the `EXIT` trap: `mktemp` creates the staged
 * file, so every step after it that fails would otherwise leave a
 * world-readable-by-root fragment of a config file beside the real one, named
 * closely enough to be mistaken for it. The trap runs on the way out either
 * way; after a successful `mv` there is nothing left at that path to remove.
 */
export function installFile(
	contents: string,
	destination: string,
	mode: string,
	owner: string = ROOT_OWNED
): string {
	const encoded = Buffer.from(contents, 'utf8').toString('base64');
	return (
		`( staged=$(mktemp ${destination}.XXXXXX) && trap 'rm -f "$staged"' EXIT` +
		` && echo ${encoded} | base64 -d > "$staged"` +
		` && chown ${owner} "$staged" && chmod ${mode} "$staged"` +
		` && mv -f "$staged" ${destination} )`
	);
}

/**
 * Everything the machine needs in place before the symlink moves: the release
 * owned by root, the unit file, and the environment file.
 *
 * The environment file is written only when it is absent. It is where secrets
 * go when there are any, and a deploy that overwrote it would delete them — so
 * the repository owns the template and the machine owns the file.
 *
 * Separate from the switch on purpose: a bad unit file or an unreadable
 * release should stop the deploy while the previous release is still live,
 * rather than become something to roll back from.
 */
async function prepareRelease(target: string): Promise<void> {
	await remote(`
chown -R root:root ${target}
chmod -R go-w ${target}
test -f ${ENV_FILE} || ${installFile(template('fit.env.example'), ENV_FILE, '0600')}
${installFile(template('fit.service'), UNIT_FILE, '0644')}
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
`);
}

/** How long a release has to answer before it is judged not to have started. */
const HEALTH_ATTEMPTS = 60;

/** A path only this app serves, and the one the smoke check reads first. */
const HEALTH_PATH = '/signin';

/** Switch the symlink, restart, wait — and go back if it never answered. */
async function activate(release: string, previous: string | null): Promise<void> {
	const target = `${RELEASES_ROOT}/${release}`;
	await prepareRelease(target);
	await remote(
		activationScript({
			target,
			previous: previous === target ? null : previous,
			currentLink: CURRENT_LINK,
			serviceName: SERVICE_NAME,
			port: APP_PORT,
			healthPath: HEALTH_PATH,
			attempts: HEALTH_ATTEMPTS
		})
	);
}

/** Everything older than the releases worth keeping, and never the live one. */
async function pruneReleases(): Promise<void> {
	await remote(
		pruneReleasesScript({
			releasesRoot: RELEASES_ROOT,
			currentLink: CURRENT_LINK,
			kept: RELEASES_KEPT,
			generations: ASSET_GENERATIONS
		})
	);
}

/**
 * The hashed assets a client that is still holding an older shell will ask
 * for, put where the release about to go live can serve them.
 *
 * Before the symlink moves, and that ordering is load-bearing: adapter-node
 * serves `build/client` through `sirv`, which outside dev mode walks the
 * directory once at startup and answers from that map. An asset linked in
 * after the restart would be on disk and still 404.
 */
async function retainAssets(release: string): Promise<void> {
	await remote(
		retainAssetsScript({
			target: `${RELEASES_ROOT}/${release}`,
			releasesRoot: RELEASES_ROOT,
			generations: ASSET_GENERATIONS
		})
	);
}

export async function deploy(argv: string[]): Promise<boolean> {
	const options = parseOptions(argv);
	const host = deployHost();
	const version = pinnedNodeVersion();
	const release = await releaseCommit();
	// Before the build and before anything touches the VM: a commit whose own
	// CI run on main is not green should never become a release. See
	// `main-ci-gate.ts` for why, and `FIT_DEPLOY_ALLOW_RED_MAIN` for the escape
	// hatch on the day this check itself is broken.
	await assertMainCiGreen(release);
	// Before the build, because the build is what bakes the version in: the tag
	// for the merge being deployed is usually seconds old and this checkout has
	// never fetched it. `release-version.ts` has how long it waits and why.
	const released = await currentReleaseVersion();
	console.log(`Deploying ${release} (${released}) to ${host} (Node v${version}).`);

	await run('bun', ['run', 'build']);
	await stageRuntimeDependencies();
	await prepareMachine(version);
	const previous = await liveRelease();
	await shipRelease(release, previous);
	await retainAssets(release);
	try {
		await activateAndPrune(() => activate(release, previous), pruneReleases);
	} catch (error) {
		console.error(describeActivationFailure(error, release, previous));
		return false;
	}

	console.log(`Live: ${CURRENT_LINK} -> ${RELEASES_ROOT}/${release}`);
	console.log(`Environment: ${ENV_FILE} (edit on the machine; the deploy never overwrites it).`);
	console.log(`Smoke check against ${options.tunnel ? 'an SSH tunnel' : PUBLIC_ORIGIN}:`);
	return smoke([
		...(options.tunnel ? ['--tunnel'] : []),
		'--commit',
		release,
		'--version',
		released
	]);
}

// Guarded, so importing this module to test a piece of it does not deploy.
if (import.meta.main) {
	process.exitCode = (await deploy(process.argv.slice(2))) ? 0 : 1;
}

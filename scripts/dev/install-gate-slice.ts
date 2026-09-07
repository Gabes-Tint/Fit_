/**
 * Installs `fit-gates.slice` into the user's systemd configuration (issue
 * #191). Explicit on purpose: the unit lives outside the repository, in
 * `~/.config`, and a gate run must never write there as a side effect of
 * being run. Until this has been run once, gates notice the missing unit and
 * run unbounded rather than pretending to a ceiling nobody declared.
 *
 * Idempotent: re-running rewrites the same bytes and reloads the user manager.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { GATE_SLICE, sliceUnitPath } from './gate-slice';
import { captureStatus } from '../security/shared';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

async function main(): Promise<void> {
	const source = path.join(projectRoot, 'scripts', 'dev', GATE_SLICE);
	const target = sliceUnitPath(process.env, homedir());
	const unit = await readFile(source, 'utf8');
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, unit);
	console.log(`Installed ${target}`);

	const reload = await captureStatus('systemctl', ['--user', 'daemon-reload']);
	if (reload.exitCode !== 0) {
		console.error(reload.output.trimEnd());
		throw new Error(`systemctl --user daemon-reload exited with code ${reload.exitCode}.`);
	}

	const shown = await captureStatus('systemctl', [
		'--user',
		'show',
		GATE_SLICE,
		'-p',
		'MemoryMax',
		'-p',
		'MemorySwapMax'
	]);
	console.log(shown.stdout.trimEnd());
	console.log(`${GATE_SLICE} is the shared ceiling for every gate run by this user.`);
}

if (import.meta.main) {
	await main();
}

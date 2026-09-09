import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where `vite build` leaves the client bundle every preview server serves.
 * `tests/e2e-build.ts` fills it once for the whole run.
 */
const CLIENT_OUTPUT = fileURLToPath(new URL('../.svelte-kit/output/client', import.meta.url));

/**
 * The URL path of the one built chunk whose code contains `marker`.
 *
 * A test that wants to do something to a single chunk — stall it, break it —
 * cannot name its file: every chunk is content-hashed, so any change to it
 * renames it. A string only that chunk's source contains survives the rename,
 * and this turns it back into the path the browser will ask for.
 *
 * Matching no chunk, or several, is an error rather than a quiet miss: a test
 * that intercepts a URL nothing requests still passes, having asserted nothing.
 */
export function builtChunkPathContaining(
	marker: string,
	clientDirectory: string = CLIENT_OUTPUT
): string {
	const scripts = readdirSync(clientDirectory, { recursive: true, encoding: 'utf8' }).filter(
		(entry) => entry.endsWith('.js')
	);
	const [match, ...rest] = scripts.filter((entry) =>
		readFileSync(join(clientDirectory, entry), 'utf8').includes(marker)
	);
	if (match === undefined || rest.length > 0) {
		throw new Error(
			`Exactly one built chunk under ${clientDirectory} has to contain ${JSON.stringify(marker)}, ` +
				`for it to name a chunk; ${match === undefined ? 'none does' : `${String(rest.length + 1)} do: ${[match, ...rest].join(', ')}`}.`
		);
	}
	return `/${match.split(sep).join('/')}`;
}

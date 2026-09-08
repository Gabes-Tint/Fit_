import { spawnSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';
import { warmBrowsers } from './e2e-warm';

/**
 * Build once for the whole run, then warm the engines it will use.
 *
 * This was `webServer.command`, which also started the one shared server. The
 * servers are per worker now (`preview-server.ts`), and they all serve the same
 * output, so the build belongs to the run rather than to any one of them.
 *
 * The warm-up belongs here for the same reason and one more: work done in
 * `globalSetup` is outside every test's timeout, and a worker's first browser
 * and first page are otherwise charged to whichever test it runs first
 * (`e2e-warm.ts` has the measurements, and #270).
 */
export default async function build(config: FullConfig): Promise<void> {
	const { status } = spawnSync('bun', ['run', 'build'], { stdio: 'inherit' });
	if (status !== 0)
		throw new Error(`The production build the suite runs against failed (${String(status)}).`);
	await warmBrowsers(config.projects.map((project) => project.name));
}

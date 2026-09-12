import { error } from '@sveltejs/kit';

/**
 * The component harness only exists for the Playwright acceptance tests.
 * The web server answers 404 before the route unless the runtime flag names
 * it as enabled (`hooks.server.ts`); the Capacitor static build has no hook
 * at all, so the WebView bakes `VITE_CAPACITOR` in and a client-side
 * navigation to a harness URL inside the shipped app errors before the page
 * renders anything. The E2E preview servers (`tests/preview-server.ts`) are
 * the only callers that set the flag - and they serve the same production
 * build every other route tests against.
 */
export function load(): void {
	if (import.meta.env.VITE_CAPACITOR) error(404, 'Not found');
}

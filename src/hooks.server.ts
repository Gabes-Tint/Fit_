import type { Handle } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { withCachePolicy } from '$lib/server/cache-policy';
import { checkOrigin } from '$lib/server/origin-policy';
import {
	requestAuthDependencies,
	resolveRequestAuth,
	type RequestAuthDependencies
} from '$lib/server/request-auth';
import { SESSION_COOKIE } from '$lib/server/session-cookie';

/**
 * Dependencies are injectable so the trust boundary is testable without the
 * application database. The origin policy runs here, not per-route, so a new
 * route is covered the day it exists and opting out is deliberate. It runs
 * before auth: a refused request must not first cost a database lookup.
 *
 * The cache policy runs on the way back out, on every exit rather than only the
 * one that reached a route, so no response leaves without saying how long it
 * may be reused. `cache-policy.ts` has what that cost us when nothing did.
 */

/** Requests under /dev/ are the test-only surface; `FIT_COMPONENT_HARNESS`
 * must name it as enabled or they are answered before anything else runs.
 * No deployed server sets that variable, so the harness route stays out of
 * production; only the E2E preview servers (`tests/preview-server.ts`) turn
 * it on, and they serve the same production build. */
const DEV_PREFIX = '/dev/';
const HARNESS_ENV = 'FIT_COMPONENT_HARNESS';

export function createHandle(
	dependencies: RequestAuthDependencies = requestAuthDependencies,
	env: Record<string, string | undefined> = process.env
): Handle {
	return async ({ event, resolve }) => {
		if (event.url.pathname.startsWith(DEV_PREFIX) && env[HARNESS_ENV] !== 'yes')
			return withCachePolicy(new Response('Not found', { status: 404 }));
		const origin = checkOrigin(event.request, event.url);
		if (!origin.allowed)
			return withCachePolicy(apiError('forbidden-origin', { reason: origin.reason }));
		event.locals.auth = resolveRequestAuth(
			event.request,
			event.cookies.get(SESSION_COOKIE),
			dependencies
		);
		return withCachePolicy(await resolve(event));
	};
}

export const handle: Handle = createHandle();

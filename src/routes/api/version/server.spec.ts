import { describe, expect, it } from 'vitest';
import type { RequestEvent } from './$types';
import { GET } from './+server';

/**
 * The build constants are compared against themselves rather than against a
 * literal: their value is whatever `vite.config.ts` substituted for the build
 * under test, which is a different string on a tag, on a branch and in a
 * sandbox with no git. What has to hold is that the endpoint answers with them.
 */

function request(): RequestEvent {
	return { url: new URL('https://fit.example/api/version') } as RequestEvent;
}

describe('GET /api/version', () => {
	it('answers with the version and commit this build carries, asking for no session', async () => {
		// No `locals` on the event below: reading one would throw rather than answer.
		const response = await GET(request());
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			version: __APP_VERSION__,
			commit: __APP_COMMIT__
		});
	});
});

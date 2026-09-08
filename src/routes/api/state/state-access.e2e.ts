import { expect, type APIRequestContext } from '@playwright/test';
import { test } from '../../../../tests/preview-server';
import { signInThroughApi } from '../../../../tests/e2e-support';

/**
 * What `/api/state` refuses, asked of the running server rather than of the
 * handler.
 *
 * `endpoints.spec.ts` already puts every refusal to `readState` and
 * `writeState` directly, and `server.spec.ts` proves the route calls them with
 * the application database. Neither says the chain in between holds: a session
 * is resolved in `hooks.server.ts`, and a route that answered before that ran —
 * or a handler wired to the wrong verb — would pass both and still hand a
 * stranger the household's journal. These are HTTP requests to the real server,
 * so nothing about the boundary is stubbed.
 */

/** The size the endpoint stops at, and the one byte past it that must be refused. */
const MAX_STATE_BODY_BYTES = 4 * 1024 * 1024;

function endpoint(baseURL: string | undefined): string {
	return new URL('/api/state', baseURL ?? '').toString();
}

/** The origin header `hooks.server.ts` requires of anything that writes. */
function headers(baseURL: string | undefined): Record<string, string> {
	return { origin: new URL(baseURL ?? '').origin };
}

/** The document as the endpoint hands it back. */
async function readState(
	api: APIRequestContext,
	baseURL: string | undefined
): Promise<{ version: number; body: unknown }> {
	const response = await api.get(endpoint(baseURL));
	expect(response.status()).toBe(200);
	return (await response.json()) as { version: number; body: unknown };
}

test.describe('a request with no session', () => {
	test('is refused the household document, and told which refusal it is', async ({
		request,
		baseURL
	}) => {
		const read = await request.get(endpoint(baseURL));

		expect(read.status()).toBe(401);
		expect(await read.json()).toMatchObject({ error: { code: 'unauthenticated' } });
	});

	test('is refused when it tries to write one, too', async ({ request, baseURL }) => {
		const written = await request.put(endpoint(baseURL), {
			headers: headers(baseURL),
			data: { version: 0, format: 'tend.v4', body: { onboarded: true } }
		});

		expect(written.status()).toBe(401);
		expect(await written.json()).toMatchObject({ error: { code: 'unauthenticated' } });
	});
});

test.describe('a state body the endpoint will not take', () => {
	test('is refused as an invalid body, and nothing is stored', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		const api = page.request;

		// Not a JSON object: the one shape check the server makes on a document it
		// otherwise keeps opaque.
		for (const body of ['a document', 42, null, ['onboarded']]) {
			const written = await api.put(endpoint(baseURL), {
				headers: headers(baseURL),
				data: { version: 0, format: 'tend.v4', body }
			});
			expect(written.status(), `body ${JSON.stringify(body)}`).toBe(400);
			expect(await written.json()).toMatchObject({ error: { code: 'invalid-body' } });
		}
		expect(await readState(api, baseURL)).toMatchObject({ version: 0, body: null });

		// The same request with an object in it is taken, which is what makes the
		// four refusals above about the body rather than about the endpoint.
		const accepted = await api.put(endpoint(baseURL), {
			headers: headers(baseURL),
			data: { version: 0, format: 'tend.v4', body: { onboarded: true } }
		});
		expect(accepted.status()).toBe(200);
		expect(await readState(api, baseURL)).toMatchObject({ version: 1, body: { onboarded: true } });
	});

	test('is refused when it is past the size ceiling, and nothing is stored', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		const api = page.request;

		const kept = await api.put(endpoint(baseURL), {
			headers: headers(baseURL),
			data: { version: 0, format: 'tend.v4', body: { note: 'small enough' } }
		});
		expect(kept.status()).toBe(200);

		// Sent as text rather than as an object, because what the endpoint
		// measures is the bytes on the wire, and over a socket rather than a
		// constructed Request — the streaming cap is not exercised anywhere else.
		const envelope = '{"version":1,"format":"tend.v4","body":{"note":""}}';
		const oversized = await api.put(endpoint(baseURL), {
			headers: { ...headers(baseURL), 'content-type': 'application/json' },
			data: envelope.replace('""', `"${'x'.repeat(MAX_STATE_BODY_BYTES)}"`)
		});

		expect(oversized.status()).toBe(400);
		expect(await oversized.json()).toMatchObject({ error: { code: 'invalid-body' } });
		// Still the small document at the version its write created: the refused
		// one neither replaced it nor moved the version on.
		expect(await readState(api, baseURL)).toMatchObject({
			version: 1,
			body: { note: 'small enough' }
		});
	});
});

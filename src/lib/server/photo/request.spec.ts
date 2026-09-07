import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BODY_BYTES, readPhotoBody } from './request';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function posted(body: string, headers: Record<string, string> = {}): Request {
	return new Request('https://fit.example/api/meals/photo', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body
	});
}

function sending(fields: unknown, headers: Record<string, string> = {}): Request {
	return posted(JSON.stringify(fields), headers);
}

const REFUSED = { ok: false, code: 'invalid-body' };

/**
 * A request that declares no length, so the text ceiling is what decides. A real
 * `Request` sets `content-length` from its body, which would refuse an oversized
 * one at the header and leave the second check untested.
 */
function streaming(body: string): Request {
	return {
		headers: new Headers({ 'content-type': 'application/json' }),
		text: () => Promise.resolve(body)
	} as unknown as Request;
}

describe('readPhotoBody', () => {
	it('reads a still and the meal it belongs to', async () => {
		const parsed = await readPhotoBody(sending({ image: IMAGE, meal: 'dinner' }));
		expect(parsed).toEqual({ ok: true, image: IMAGE, meal: 'dinner' });
	});

	it('refuses a body that does not declare JSON', async () => {
		// The full matrix of content types is `declaredMediaType`'s, tested once in
		// `api.spec.ts`; this is readPhotoBody's own refusal shape for the case it
		// names.
		const request = new Request('https://fit.example/api/meals/photo', {
			method: 'POST',
			body: JSON.stringify({ image: IMAGE, meal: 'lunch' })
		});
		request.headers.delete('content-type');
		expect(await readPhotoBody(request)).toEqual(REFUSED);
	});

	it('refuses a body whose declared length is over the ceiling, before reading it', async () => {
		const parsed = await readPhotoBody(
			sending(
				{ image: IMAGE, meal: 'lunch' },
				{ 'content-length': String(MAX_PHOTO_BODY_BYTES + 1) }
			)
		);
		expect(parsed).toEqual(REFUSED);
	});

	it('allows a body declared at exactly the ceiling', async () => {
		const parsed = await readPhotoBody(
			sending({ image: IMAGE, meal: 'lunch' }, { 'content-length': String(MAX_PHOTO_BODY_BYTES) })
		);
		expect(parsed).toMatchObject({ ok: true });
	});

	it('allows text that is exactly the ceiling long', async () => {
		const padding = 'A'.repeat(80);
		const body = JSON.stringify({ image: IMAGE, meal: 'lunch', pad: padding });
		const exact = `${body.slice(0, -1)}${' '.repeat(MAX_PHOTO_BODY_BYTES - body.length)}}`;
		expect(exact).toHaveLength(MAX_PHOTO_BODY_BYTES);
		expect(await readPhotoBody(streaming(exact))).toMatchObject({ ok: true });
	});

	it('refuses text one character past the ceiling, whatever the header claimed', async () => {
		const body = JSON.stringify({ image: IMAGE, meal: 'lunch' });
		const huge = `${body.slice(0, -1)}${' '.repeat(MAX_PHOTO_BODY_BYTES - body.length + 1)}}`;
		expect(huge).toHaveLength(MAX_PHOTO_BODY_BYTES + 1);
		expect(await readPhotoBody(streaming(huge))).toEqual(REFUSED);
	});

	it('stays under adapter-node’s own 512 KB body limit, so this ceiling is reachable', () => {
		expect(MAX_PHOTO_BODY_BYTES).toBe(450 * 1024);
		expect(MAX_PHOTO_BODY_BYTES).toBeLessThan(512 * 1024);
	});

	it('refuses text that is not JSON', async () => {
		expect(await readPhotoBody(posted('not json at all'))).toEqual(REFUSED);
	});

	it('refuses a JSON body that is not an object', async () => {
		expect(await readPhotoBody(posted('"a string"'))).toEqual(REFUSED);
	});

	it('refuses a null body', async () => {
		expect(await readPhotoBody(posted('null'))).toEqual(REFUSED);
	});

	it('refuses a PNG data URL: only the capture path is a caller this endpoint serves', async () => {
		const png = 'data:image/png;base64,iVBORw0KGgo=';
		expect(await readPhotoBody(sending({ image: png, meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses a data URL with anything in front of it', async () => {
		const prefixed = `https://example.com/#${IMAGE}`;
		expect(await readPhotoBody(sending({ image: prefixed, meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses an image sent as an array, which stringifies into a valid data URL', async () => {
		// `RegExp.test` coerces, so without the type check this one-element array
		// would match and be forwarded to a paid API as the image.
		expect(await readPhotoBody(sending({ image: [IMAGE], meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses a URL that is not a data URL at all', async () => {
		const remote = 'https://example.com/plate.jpg';
		expect(await readPhotoBody(sending({ image: remote, meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses a JPEG data URL carrying something that is not base64', async () => {
		const bad = 'data:image/jpeg;base64,not base64!!';
		expect(await readPhotoBody(sending({ image: bad, meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses an empty image', async () => {
		expect(
			await readPhotoBody(sending({ image: 'data:image/jpeg;base64,', meal: 'lunch' }))
		).toEqual(REFUSED);
	});

	it('refuses an image that is not a string', async () => {
		expect(await readPhotoBody(sending({ image: 12, meal: 'lunch' }))).toEqual(REFUSED);
	});

	it('refuses a meal that is not one of the four', async () => {
		expect(await readPhotoBody(sending({ image: IMAGE, meal: 'elevenses' }))).toEqual(REFUSED);
	});

	it('refuses a meal that is not a string', async () => {
		expect(await readPhotoBody(sending({ image: IMAGE, meal: 3 }))).toEqual(REFUSED);
	});

	it('refuses a body with no meal at all', async () => {
		expect(await readPhotoBody(sending({ image: IMAGE }))).toEqual(REFUSED);
	});

	it('accepts every meal the app offers', async () => {
		for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
			expect(await readPhotoBody(sending({ image: IMAGE, meal }))).toMatchObject({
				ok: true,
				meal
			});
		}
	});

	it('refuses a body whose stream cannot be read', async () => {
		const request = posted(JSON.stringify({ image: IMAGE, meal: 'lunch' }));
		const broken = {
			headers: request.headers,
			text: () => Promise.reject(new Error('socket closed'))
		} as unknown as Request;
		expect(await readPhotoBody(broken)).toEqual(REFUSED);
	});
});

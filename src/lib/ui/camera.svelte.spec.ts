import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubMediaDevices } from '$lib/testing/fixtures';
import { CAPTURE_MAX_EDGE, captureFrame, readImageFile, startCamera } from './camera';

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** A stream with real frames: a canvas can produce one without a camera. */
function fakeStream(width = 640, height = 480) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (context) {
		context.fillStyle = '#3f5a48';
		context.fillRect(0, 0, width, height);
	}
	return canvas.captureStream(1);
}

afterEach(() => {
	delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
	vi.restoreAllMocks();
});

describe('startCamera', () => {
	it('reports an unsupported browser rather than throwing', async () => {
		stubMediaDevices(undefined);
		await expect(startCamera()).resolves.toEqual({ ok: false, reason: 'unsupported' });
	});

	it('reports an unsupported browser when the API is a stub without getUserMedia', async () => {
		stubMediaDevices({});
		await expect(startCamera()).resolves.toEqual({ ok: false, reason: 'unsupported' });
	});

	it('opens a stream when the browser can', async () => {
		const stream = fakeStream();
		stubMediaDevices({ getUserMedia: vi.fn(() => Promise.resolve(stream)) satisfies GetUserMedia });
		const result = await startCamera();
		expect(result).toMatchObject({ ok: true, stream });
	});

	it('asks for the camera pointed away from the face', async () => {
		const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
		stubMediaDevices({ getUserMedia });
		await startCamera();
		expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } } });
	});

	it('stops every track when the caller lets go', async () => {
		const stream = fakeStream();
		const stops = stream.getTracks().map((track) => vi.spyOn(track, 'stop'));
		stubMediaDevices({ getUserMedia: vi.fn(() => Promise.resolve(stream)) });
		const result = await startCamera();
		if (result.ok) result.stop();
		expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
	});

	it('names a declined permission, which the person can undo', async () => {
		stubMediaDevices({
			getUserMedia: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
		});
		await expect(startCamera()).resolves.toEqual({ ok: false, reason: 'denied' });
	});

	it('treats any other failure as the camera being unavailable', async () => {
		stubMediaDevices({
			getUserMedia: vi.fn(() => Promise.reject(new DOMException('busy', 'NotReadableError')))
		});
		await expect(startCamera()).resolves.toEqual({ ok: false, reason: 'unavailable' });
	});

	it('treats a plain error as the camera being unavailable', async () => {
		stubMediaDevices({
			getUserMedia: vi.fn(() => Promise.reject(new Error('nope')))
		});
		await expect(startCamera()).resolves.toEqual({ ok: false, reason: 'unavailable' });
	});
});

/** A video element cannot be sized directly, so a stand-in carries the dimensions. */
function videoOfSize(width: number, height: number) {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(width, 1);
	canvas.height = Math.max(height, 1);
	return Object.assign(canvas, {
		videoWidth: width,
		videoHeight: height
	}) as unknown as HTMLVideoElement;
}

describe('captureFrame', () => {
	it('gives nothing back before the stream reports its size', () => {
		expect(captureFrame(videoOfSize(0, 0))).toBeNull();
	});

	it('gives nothing back when only one dimension is known', () => {
		expect(captureFrame(videoOfSize(640, 0))).toBeNull();
	});

	it('produces a JPEG data URL from a sized frame', () => {
		expect(captureFrame(videoOfSize(640, 480))).toMatch(/^data:image\/jpeg;base64,/);
	});

	it('scales a large sensor down to the longest edge it allows', async () => {
		const url = captureFrame(videoOfSize(4000, 3000));
		const image = new Image();
		image.src = url ?? '';
		await image.decode();
		expect(image.naturalWidth).toBe(CAPTURE_MAX_EDGE);
	});

	it('scales by the taller edge on a portrait frame', async () => {
		const url = captureFrame(videoOfSize(3000, 4000));
		const image = new Image();
		image.src = url ?? '';
		await image.decode();
		expect(image.naturalHeight).toBe(CAPTURE_MAX_EDGE);
	});

	it('leaves a frame smaller than the limit at its own size', async () => {
		const url = captureFrame(videoOfSize(320, 240));
		const image = new Image();
		image.src = url ?? '';
		await image.decode();
		expect(image.naturalWidth).toBe(320);
	});

	it('honours a smaller limit when one is asked for', async () => {
		const url = captureFrame(videoOfSize(640, 480), 100);
		const image = new Image();
		image.src = url ?? '';
		await image.decode();
		expect(image.naturalWidth).toBe(100);
	});
});

/** A real encoded picture, the way one arrives from the gallery. */
async function pictureFile(width = 640, height = 480, type = 'image/png') {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (context) {
		context.fillStyle = '#3f5a48';
		context.fillRect(0, 0, width, height);
	}
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
	if (!blob) throw new Error('the canvas produced no blob');
	return new File([blob], 'plate.png', { type });
}

async function sizeOf(dataUrl: string) {
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	return { width: image.naturalWidth, height: image.naturalHeight };
}

describe('readImageFile', () => {
	it('refuses a file that is not a picture at all', async () => {
		const file = new File(['not a picture'], 'notes.txt', { type: 'text/plain' });
		await expect(readImageFile(file)).resolves.toEqual({ ok: false, reason: 'not-an-image' });
	});

	it('reports a picture the browser cannot decode rather than throwing', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' });
		await expect(readImageFile(file)).resolves.toEqual({ ok: false, reason: 'unreadable' });
	});

	it('turns a chosen picture into the same kind of still the camera gives', async () => {
		const result = await readImageFile(await pictureFile());
		expect(result.ok && result.shot).toMatch(/^data:image\/jpeg;base64,/);
	});

	it('scales a full-resolution picture down to the longest edge it allows', async () => {
		const result = await readImageFile(await pictureFile(2000, 1500));
		if (!result.ok) throw new Error(result.reason);
		await expect(sizeOf(result.shot)).resolves.toMatchObject({ width: CAPTURE_MAX_EDGE });
	});

	it('scales by the taller edge on a portrait picture', async () => {
		const result = await readImageFile(await pictureFile(1500, 2000));
		if (!result.ok) throw new Error(result.reason);
		await expect(sizeOf(result.shot)).resolves.toMatchObject({ height: CAPTURE_MAX_EDGE });
	});

	it('leaves a picture smaller than the limit at its own size', async () => {
		const result = await readImageFile(await pictureFile(320, 240));
		if (!result.ok) throw new Error(result.reason);
		await expect(sizeOf(result.shot)).resolves.toEqual({ width: 320, height: 240 });
	});

	it('honours a smaller limit when one is asked for', async () => {
		const result = await readImageFile(await pictureFile(640, 480), 100);
		if (!result.ok) throw new Error(result.reason);
		await expect(sizeOf(result.shot)).resolves.toMatchObject({ width: 100 });
	});

	it('lets go of the blob it borrowed to decode the picture', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		await readImageFile(await pictureFile());
		expect(revoke).toHaveBeenCalled();
	});

	it('lets go of the blob even when the picture will not decode', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		await readImageFile(new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' }));
		expect(revoke).toHaveBeenCalled();
	});
});

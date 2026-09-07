import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	jsonResponse,
	paintingStream,
	routine,
	signedInSession,
	stopPainting,
	stubMediaDevices
} from './fixtures';

describe('stubMediaDevices', () => {
	afterEach(() => {
		Reflect.deleteProperty(navigator, 'mediaDevices');
	});

	it('shadows navigator.mediaDevices with the given value', () => {
		const value = { getUserMedia: () => Promise.resolve() };
		stubMediaDevices(value);
		expect(navigator.mediaDevices).toBe(value);
	});

	it('leaves the property configurable, so a test can delete it afterward', () => {
		stubMediaDevices(undefined);
		expect(Reflect.deleteProperty(navigator, 'mediaDevices')).toBe(true);
	});
});

describe('paintingStream / stopPainting', () => {
	const fillRect = vi.fn();
	const captureStream = vi.fn(() => 'the-stream' as unknown as MediaStream);

	beforeEach(() => {
		vi.useFakeTimers();
		fillRect.mockClear();
		captureStream.mockClear();
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
			type === '2d'
				? ({ fillStyle: '', fillRect } as unknown as CanvasRenderingContext2D)
				: null) as never);
		Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
			configurable: true,
			value: captureStream
		});
	});

	afterEach(() => {
		stopPainting();
		vi.useRealTimers();
		vi.restoreAllMocks();
		Reflect.deleteProperty(HTMLCanvasElement.prototype, 'captureStream');
	});

	it('builds a 320x240 canvas and captures it at 30fps', () => {
		const stream = paintingStream();
		expect(stream).toBe('the-stream');
		expect(captureStream).toHaveBeenCalledWith(30);
	});

	it('repaints the canvas on a timer', () => {
		paintingStream();
		expect(fillRect).not.toHaveBeenCalled();
		vi.advanceTimersByTime(30);
		expect(fillRect).toHaveBeenCalledWith(0, 0, 320, 240);
		expect(fillRect).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(60);
		expect(fillRect).toHaveBeenCalledTimes(3);
	});

	it('stopPainting clears exactly the interval this call started, nothing extra', async () => {
		// A fresh module instance: the module-level interval-id list starts from
		// its real initial state, not whatever earlier tests left behind.
		vi.resetModules();
		const fresh = await import('./fixtures');
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
		fresh.paintingStream();
		fresh.stopPainting();
		expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
	});

	it('stopPainting clears the timer, so nothing repaints afterward', () => {
		paintingStream();
		stopPainting();
		vi.advanceTimersByTime(300);
		expect(fillRect).not.toHaveBeenCalled();
	});
});

describe('routine', () => {
	it('builds a routine with no exercises and a default weekly frequency of 3', () => {
		expect(routine('push', 'Chest & Shoulders')).toEqual({
			id: 'push',
			name: 'Chest & Shoulders',
			freq: 3,
			exercises: []
		});
	});

	it('accepts an explicit frequency', () => {
		expect(routine('legs', 'Legs', 2).freq).toBe(2);
	});
});

describe('signedInSession', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('defaults to account robin, one household, expiring 90 days from now', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
		const session = signedInSession();
		expect(session).toEqual({
			account: { id: 'a-1', username: 'robin', displayName: 'Robin', createdAt: '2026-08-01' },
			households: [{ householdId: 'h-1', name: 'Home', role: 'owner' }],
			expiresAt: new Date(
				Date.parse('2026-01-01T00:00:00.000Z') + 90 * 24 * 60 * 60 * 1000
			).toISOString()
		});
	});

	it('accepts an explicit expiry', () => {
		expect(signedInSession('2030-01-01T00:00:00.000Z').expiresAt).toBe('2030-01-01T00:00:00.000Z');
	});
});

describe('jsonResponse', () => {
	it('serializes the body as JSON with a content-type header, status 200 by default', async () => {
		const response = jsonResponse({ a: 1 });
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(await response.json()).toEqual({ a: 1 });
	});

	it('applies init, e.g. a status override', () => {
		expect(jsonResponse({ error: true }, { status: 404 }).status).toBe(404);
	});

	it('lets init.headers override the default content-type', () => {
		const response = jsonResponse({}, { headers: { 'content-type': 'text/plain' } });
		expect(response.headers.get('content-type')).toBe('text/plain');
	});
});

/**
 * Fixtures shared across component/unit specs (see #169). Each one replaces a
 * byte-identical copy that used to live in two or more spec files; a helper
 * only belongs here once every caller genuinely does the same thing with it.
 */
import type { SignedInSession } from '$lib/auth/api';
import type { Routine } from '$lib/domain/types';

/**
 * `navigator.mediaDevices` is a prototype getter, so an own property shadows
 * it for the length of a test and `delete` puts the real one back.
 */
export function stubMediaDevices(value: unknown): void {
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });
}

const painters: number[] = [];

/** A still canvas emits no frames, so it repaints on a timer. */
export function paintingStream(): MediaStream {
	const canvas = document.createElement('canvas');
	canvas.width = 320;
	canvas.height = 240;
	const context = canvas.getContext('2d');
	let tick = 0;
	painters.push(
		setInterval(() => {
			if (!context) return;
			context.fillStyle = tick++ % 2 ? '#3f5a48' : '#f3eee4';
			context.fillRect(0, 0, canvas.width, canvas.height);
		}, 30) as unknown as number
	);
	return canvas.captureStream(30);
}

/** Stops every interval `paintingStream` started and not yet cleared. Call from `afterEach`. */
export function stopPainting(): void {
	for (const painter of painters.splice(0)) clearInterval(painter);
}

/** A minimal routine: an id, a name, and no exercises. */
export function routine(id: string, name: string): Routine {
	return { id, name, exercises: [], deletedAt: null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A signed-in session for account `robin`, one household, expiring 90 days out by default. */
export function signedInSession(
	expiresAt = new Date(Date.now() + 90 * DAY_MS).toISOString()
): SignedInSession {
	return {
		account: { id: 'a-1', username: 'robin', displayName: 'Robin', createdAt: '2026-08-01' },
		households: [{ householdId: 'h-1', name: 'Home', role: 'owner' }],
		expiresAt
	};
}

/** A JSON `Response`, for stubbing `fetch`. `init` carries `status` and, rarely, extra headers. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { 'content-type': 'application/json', ...init.headers }
	});
}

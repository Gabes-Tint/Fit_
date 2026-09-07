import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_FORM_CUES, FORM_CUES } from '$lib/domain/exercise-catalog';
import FormCheckModal from './FormCheckModal.svelte';

const BENCH_CUES = FORM_CUES['Bench Press'] ?? [];

/** Cues are handwritten, so a repeated line is possible; keyed by text it would throw at runtime. */
const REPEATED = 'Brace before the descent';
const REPEATER = 'Repeated Cue Movement';
beforeAll(() => {
	(FORM_CUES as Record<string, readonly string[]>)[REPEATER] = [REPEATED, REPEATED];
});
afterAll(() => {
	delete (FORM_CUES as Record<string, readonly string[]>)[REPEATER];
});

describe('FormCheckModal', () => {
	it('shows nothing until it is opened', async () => {
		await render(FormCheckModal, {
			props: { open: false, name: 'Bench Press', onclose: vi.fn() }
		});
		expect(document.body.textContent).not.toContain('Form check');
	});

	it('names the movement it is checking', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Squat', onclose: vi.fn() } });
		await expect.element(page.getByText('Squat')).toBeInTheDocument();
		await expect.element(page.getByText('Form check')).toBeInTheDocument();
	});

	it('gives the three written cues for a movement that has them', async () => {
		await render(FormCheckModal, {
			props: { open: true, name: 'Bench Press', onclose: vi.fn() }
		});
		expect(BENCH_CUES).toHaveLength(3);
		for (const cue of BENCH_CUES) {
			await expect.element(page.getByText(cue)).toBeInTheDocument();
		}
	});

	it('numbers the cues in the order they are to be read', async () => {
		await render(FormCheckModal, {
			props: { open: true, name: 'Bench Press', onclose: vi.fn() }
		});
		for (const n of ['1', '2', '3']) {
			await expect.element(page.getByText(n, { exact: true })).toBeInTheDocument();
		}
	});

	it('falls back to the general cues for a movement nothing was written for', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Shrug', onclose: vi.fn() } });
		for (const cue of DEFAULT_FORM_CUES) {
			await expect.element(page.getByText(cue)).toBeInTheDocument();
		}
		await expect.element(page.getByText(BENCH_CUES[0] ?? '')).not.toBeInTheDocument();
	});

	it('lists a repeated cue twice rather than falling over on it', async () => {
		await render(FormCheckModal, { props: { open: true, name: REPEATER, onclose: vi.fn() } });
		expect(page.getByText(REPEATED).elements()).toHaveLength(2);
		await expect.element(page.getByText('2', { exact: true })).toBeInTheDocument();
	});

	it('is honest that the demonstration is not there yet', async () => {
		await render(FormCheckModal, {
			props: { open: true, name: 'Bench Press', onclose: vi.fn() }
		});
		await expect.element(page.getByText('A demonstration clip belongs here')).toBeInTheDocument();
		expect(document.querySelector('video')).toBeNull();
	});

	it('does not show the honest placeholder for a movement with a real clip', async () => {
		for (const name of ['Push-up', 'Squat']) {
			await render(FormCheckModal, { props: { open: true, name, onclose: vi.fn() } });
			await expect
				.element(page.getByText('A demonstration clip belongs here'))
				.not.toBeInTheDocument();
		}
	});

	it('plays the push-up demo clip from static, not the bundle, with an accessible label', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
		const video = document.querySelector('video');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('/media/push-up-demo.mp4');
		expect(video?.getAttribute('aria-label')?.toLowerCase()).toContain('push-up');
	});

	it('plays the squat demo clip from static, not the bundle, with an accessible label', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Squat', onclose: vi.fn() } });
		const video = document.querySelector('video');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('/media/squat-demo.mp4');
		expect(video?.getAttribute('aria-label')?.toLowerCase()).toContain('squat');
	});

	it('never fetches the clip until the modal is opened', async () => {
		await render(FormCheckModal, { props: { open: false, name: 'Push-up', onclose: vi.fn() } });
		expect(document.querySelector('video')).toBeNull();
	});

	it('does not eagerly preload the clip once opened', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
		const video = document.querySelector('video');
		expect(video?.getAttribute('preload')).toBe('none');
	});

	it('autoplays, loops and hides native controls, staying silent and inline', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
		const video = document.querySelector('video');
		expect(video?.hasAttribute('autoplay')).toBe(true);
		expect(video?.hasAttribute('loop')).toBe(true);
		expect(video?.muted).toBe(true);
		expect(video?.hasAttribute('playsinline')).toBe(true);
		expect(video?.hasAttribute('controls')).toBe(false);
	});

	it('names the tap/keyboard pause affordance in its accessible name', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
		const video = document.querySelector('video');
		const label = video?.getAttribute('aria-label')?.toLowerCase() ?? '';
		expect(label).toContain('pause');
		expect(label).toContain('play');
	});

	it('toggles play and pause when the clip is clicked, since there are no visible controls', async () => {
		const playSpy = vi
			.spyOn(HTMLMediaElement.prototype, 'play')
			.mockImplementation(() => Promise.resolve());
		const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
		try {
			await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
			const video = document.querySelector('video') as HTMLVideoElement;
			expect(video).not.toBeNull();

			video.click();
			expect(playSpy).toHaveBeenCalledTimes(1);

			Object.defineProperty(video, 'paused', { value: false, configurable: true });
			video.click();
			expect(pauseSpy).toHaveBeenCalledTimes(1);
		} finally {
			playSpy.mockRestore();
			pauseSpy.mockRestore();
		}
	});

	it('is keyboard reachable and toggles on Enter and Space, not just click', async () => {
		const playSpy = vi
			.spyOn(HTMLMediaElement.prototype, 'play')
			.mockImplementation(() => Promise.resolve());
		const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
		try {
			await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
			const video = document.querySelector('video') as HTMLVideoElement;
			expect(video.tabIndex).toBe(0);

			video.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
			);
			expect(playSpy).toHaveBeenCalledTimes(1);

			Object.defineProperty(video, 'paused', { value: false, configurable: true });
			video.dispatchEvent(
				new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
			);
			expect(pauseSpy).toHaveBeenCalledTimes(1);
		} finally {
			playSpy.mockRestore();
			pauseSpy.mockRestore();
		}
	});

	it('does not autoplay when the system asks for reduced motion', async () => {
		const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
			(query: string) =>
				({
					matches: query === '(prefers-reduced-motion: reduce)',
					media: query,
					onchange: null,
					addListener: vi.fn(),
					removeListener: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					dispatchEvent: vi.fn()
				}) as MediaQueryList
		);
		try {
			await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
			const video = document.querySelector('video');
			expect(video?.hasAttribute('autoplay')).toBe(false);
		} finally {
			matchMediaSpy.mockRestore();
		}
	});

	it('keeps the clip square, not the video-wide placeholder shape', async () => {
		await render(FormCheckModal, { props: { open: true, name: 'Push-up', onclose: vi.fn() } });
		const video = document.querySelector('video');
		expect(video?.className).toContain('aspect-square');
	});

	it('tells whoever opened it when it is done with', async () => {
		const onclose = vi.fn();
		await render(FormCheckModal, { props: { open: true, name: 'Squat', onclose } });
		await page.getByRole('button', { name: 'Got it' }).click();
		expect(onclose).toHaveBeenCalledTimes(1);
	});
});

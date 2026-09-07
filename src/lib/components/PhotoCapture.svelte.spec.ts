import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { paintingStream, stopPainting, stubMediaDevices } from '$lib/testing/fixtures';
import PhotoCapture from './PhotoCapture.svelte';

/** Long enough for a real video element to receive its first frame. */
const FRAME = { timeout: 5000 };

function openable() {
	const stream = paintingStream();
	stubMediaDevices({ getUserMedia: vi.fn(() => Promise.resolve(stream)) });
	return stream;
}

function failing(name: string) {
	stubMediaDevices({
		getUserMedia: vi.fn(() => Promise.reject(new DOMException('no', name)))
	});
}

const shutter = () => page.getByRole('button', { name: 'Take photo' });
const readButton = () => page.getByRole('button', { name: 'Read this plate' });

/** One row of `/api/meals/photo`'s answer, for a food the catalog could not match. */
const EGG = { label: 'fried egg', grams: 60, food: null, alternatives: [] };

/** What `readPhoto` makes of that row: the wire's `alternatives` are not carried. */
const EGG_FOOD = { label: 'fried egg', grams: 60, food: null };

/** Stubs the endpoint, the way `FoodSearch.svelte.spec.ts` stubs the catalog. */
function serverAnswers(status: number, body: unknown = {}) {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

const props = {
	route: 'camera' as const,
	meal: 'lunch' as const,
	ontype: vi.fn(),
	onfoods: vi.fn()
};

const camera = () =>
	render(PhotoCapture, { props: { ...props, ontype: vi.fn(), onfoods: vi.fn() } });
const upload = () =>
	render(PhotoCapture, {
		props: { ...props, route: 'file' as const, ontype: vi.fn(), onfoods: vi.fn() }
	});

async function shoot() {
	await expect.element(shutter(), FRAME).toBeEnabled();
	await shutter().click();
}

/** A real encoded picture, the way one arrives from the gallery. */
async function pictureFile(width = 320, height = 240) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (context) {
		context.fillStyle = '#3f5a48';
		context.fillRect(0, 0, width, height);
	}
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('the canvas produced no blob');
	return new File([blob], 'plate.png', { type: 'image/png' });
}

/** The browser opens the picker outside the page, so no test can drive it. */
function choose(file: File) {
	const input = document.querySelector('input[type="file"]');
	if (!(input instanceof HTMLInputElement)) throw new Error('no file input was rendered');
	const data = new DataTransfer();
	data.items.add(file);
	input.files = data.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
	stopPainting();
	delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
	vi.restoreAllMocks();
});

describe('PhotoCapture, pointed at the camera', () => {
	it('opens the camera with the pane, rather than behind another button', async () => {
		const getUserMedia = vi.fn(() => Promise.resolve(paintingStream()));
		stubMediaDevices({ getUserMedia });
		await camera();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
		expect(getUserMedia).toHaveBeenCalled();
	});

	it('holds the shutter until the camera is producing frames', async () => {
		openable();
		await camera();
		await expect.element(shutter(), FRAME).toBeEnabled();
	});

	it('disables the shutter before the stream reports a size', async () => {
		openable();
		await camera();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
		await expect.element(shutter()).toBeDisabled();
	});

	it('marks the shutter busy until the stream reports a size', async () => {
		openable();
		await camera();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
		expect(
			document.querySelector('button[aria-label="Take photo"]')?.getAttribute('aria-busy')
		).toBe('true');
		await expect.element(shutter(), FRAME).toBeEnabled();
		expect(
			document.querySelector('button[aria-label="Take photo"]')?.getAttribute('aria-busy')
		).toBe('false');
	});

	it('says the camera is waking up until the stream reports a size, then stops', async () => {
		openable();
		await camera();
		await expect.element(page.getByText('Waking the camera…')).toBeInTheDocument();
		await expect.element(shutter(), FRAME).toBeEnabled();
		expect(document.body.textContent).not.toContain('Waking the camera…');
	});

	it('is the only capture control below the preview', async () => {
		openable();
		await camera();
		await expect.element(shutter(), FRAME).toBeEnabled();
		expect(page.getByRole('button', { name: 'Take the picture' }).query()).toBeNull();
	});

	it('renders as a sibling of the video inside the preview wrapper', async () => {
		openable();
		await camera();
		await expect.element(shutter(), FRAME).toBeEnabled();
		const video = document.querySelector('video[aria-label="Camera viewfinder"]');
		const button = document.querySelector('button[aria-label="Take photo"]');
		expect(video).not.toBeNull();
		expect(button).not.toBeNull();
		expect(button?.parentElement).toBe(video?.parentElement);
	});

	it('shows what the camera saw after the shutter', async () => {
		openable();
		await camera();
		await shoot();
		await expect.element(page.getByAltText('What the camera just saw')).toBeInTheDocument();
	});

	it('captures an actual frame rather than an empty one', async () => {
		openable();
		await camera();
		await shoot();
		const src = document.querySelector('img')?.getAttribute('src') ?? '';
		expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
	});

	it('says nothing about a photo leaving the device until there is one', async () => {
		openable();
		await camera();
		expect(document.body.textContent).not.toContain('goes to OpenAI');
	});

	it('says where the still goes, before offering to send it', async () => {
		openable();
		await camera();
		await shoot();
		expect(document.body.textContent).toContain('The photo goes to OpenAI to be read.');
		expect(document.body.textContent).toContain('It isn’t stored.');
	});

	it('offers to read the plate once there is a still', async () => {
		openable();
		await camera();
		await shoot();
		await expect.element(readButton()).toBeInTheDocument();
	});

	it('lets go of the camera as soon as there is a still', async () => {
		const stream = openable();
		const stops = stream.getTracks().map((track) => vi.spyOn(track, 'stop'));
		await camera();
		await shoot();
		expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
	});

	it('lets go of the camera when the pane goes away', async () => {
		const stream = openable();
		const stops = stream.getTracks().map((track) => vi.spyOn(track, 'stop'));
		const pane = await camera();
		await expect.element(shutter(), FRAME).toBeEnabled();
		await pane.unmount();
		expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
	});

	it('goes back to the viewfinder to retake', async () => {
		openable();
		await camera();
		await shoot();
		await page.getByRole('button', { name: 'Retake' }).click();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
	});

	it('sends the user to typing when they ask for it', async () => {
		openable();
		const ontype = vi.fn();
		await render(PhotoCapture, { props: { ...props, ontype, onfoods: vi.fn() } });
		await page.getByRole('button', { name: 'Type it instead' }).click();
		expect(ontype).toHaveBeenCalled();
	});

	it('names a declined permission and how to undo it', async () => {
		failing('NotAllowedError');
		await camera();
		await expect.element(page.getByText(/undo that in your settings/)).toBeInTheDocument();
	});

	it('says when the camera could not be opened at all', async () => {
		failing('NotReadableError');
		await camera();
		await expect.element(page.getByText(/wouldn’t open/)).toBeInTheDocument();
	});

	it('says when the browser has no camera to offer', async () => {
		stubMediaDevices(undefined);
		await camera();
		await expect.element(page.getByText(/doesn’t offer a camera/)).toBeInTheDocument();
	});

	it('reaches the viewfinder when a second attempt succeeds', async () => {
		failing('NotAllowedError');
		await camera();
		await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
		openable();
		await page.getByRole('button', { name: 'Try again' }).click();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
	});
});

describe('PhotoCapture, pointed at the pictures already on the device', () => {
	it('opens the picker with the pane, rather than behind another button', async () => {
		const opened = vi.spyOn(HTMLInputElement.prototype, 'click');
		await upload();
		expect(opened).toHaveBeenCalled();
	});

	it('opens no camera at all', async () => {
		const getUserMedia = vi.fn(() => Promise.resolve(paintingStream()));
		stubMediaDevices({ getUserMedia });
		await upload();
		await expect
			.element(page.getByRole('button', { name: 'Choose a picture' }))
			.toBeInTheDocument();
		expect(getUserMedia).not.toHaveBeenCalled();
	});

	it('shows the picture that was chosen', async () => {
		await upload();
		choose(await pictureFile());
		await expect.element(page.getByAltText('The picture you chose')).toBeInTheDocument();
	});

	it('offers another pick, not a retake, for a picture that was chosen', async () => {
		await upload();
		choose(await pictureFile());
		await expect.element(page.getByRole('button', { name: 'Choose another' })).toBeInTheDocument();
	});

	it('offers a way back to the picker when it is dismissed unanswered', async () => {
		await upload();
		await expect
			.element(page.getByRole('button', { name: 'Choose a picture' }))
			.toBeInTheDocument();
	});

	it('says so when the chosen file is not a picture', async () => {
		await upload();
		choose(new File(['not a picture'], 'notes.txt', { type: 'text/plain' }));
		await expect.element(page.getByText(/isn’t a picture/)).toBeInTheDocument();
	});

	it('says so when the chosen picture will not decode', async () => {
		await upload();
		choose(new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' }));
		await expect.element(page.getByText(/couldn’t be read/)).toBeInTheDocument();
	});

	it('says here too where the picture goes, once one is chosen', async () => {
		await upload();
		choose(await pictureFile());
		await expect.element(readButton()).toBeInTheDocument();
		expect(document.body.textContent).toContain('The photo goes to OpenAI to be read.');
	});

	it('sends the user to typing when they ask for it', async () => {
		const ontype = vi.fn();
		await render(PhotoCapture, {
			props: { ...props, route: 'file' as const, ontype, onfoods: vi.fn() }
		});
		await page.getByRole('button', { name: 'Type it instead' }).click();
		expect(ontype).toHaveBeenCalled();
	});
});

describe('PhotoCapture, sending the still to be read', () => {
	beforeEach(() => {
		openable();
	});

	it('hands the foods it was told about to the sheet', async () => {
		serverAnswers(200, { items: [EGG] });
		const onfoods = vi.fn();
		await render(PhotoCapture, { props: { ...props, ontype: vi.fn(), onfoods } });
		await shoot();
		await readButton().click();
		await vi.waitFor(() => expect(onfoods).toHaveBeenCalledWith([EGG_FOOD]));
	});

	it('sends the still and the meal it belongs to', async () => {
		const fetching = serverAnswers(200, { items: [EGG] });
		await render(PhotoCapture, {
			props: { ...props, meal: 'breakfast' as const, ontype: vi.fn(), onfoods: vi.fn() }
		});
		await shoot();
		await readButton().click();
		await vi.waitFor(() => expect(fetching).toHaveBeenCalled());
		const init = (fetching.mock.calls[0] ?? [])[1] as RequestInit;
		const body = init.body;
		expect(typeof body).toBe('string');
		const sent = JSON.parse(typeof body === 'string' ? body : '{}') as {
			image: string;
			meal: string;
		};
		expect(sent.image.startsWith('data:image/jpeg;base64,')).toBe(true);
		expect(sent.meal).toBe('breakfast');
	});

	it('says so when the model recognised no food, and keeps the picture on screen', async () => {
		serverAnswers(200, { items: [] });
		const onfoods = vi.fn();
		await render(PhotoCapture, { props: { ...props, ontype: vi.fn(), onfoods } });
		await shoot();
		await readButton().click();
		await expect
			.element(page.getByText(/Couldn’t recognise any food in that photo/))
			.toBeInTheDocument();
		await expect.element(page.getByAltText('What the camera just saw')).toBeInTheDocument();
		expect(onfoods).not.toHaveBeenCalled();
	});

	it('says photo logging is off right now when the server cannot read it', async () => {
		serverAnswers(503, { error: { code: 'photo-unavailable' } });
		await camera();
		await shoot();
		await readButton().click();
		await expect
			.element(page.getByText(/Photo logging isn’t available right now/))
			.toBeInTheDocument();
	});

	it('says the day’s photos are spent when the allowance runs out', async () => {
		serverAnswers(429, { error: { code: 'too-many-attempts' } });
		await camera();
		await shoot();
		await readButton().click();
		await expect
			.element(page.getByText(/all the photos this app can read today/))
			.toBeInTheDocument();
	});

	it('says the photo is too large when the body is refused', async () => {
		serverAnswers(413, {});
		await camera();
		await shoot();
		await readButton().click();
		await expect.element(page.getByText('That photo is too large to read.')).toBeInTheDocument();
	});

	it('names the session when reading needs one', async () => {
		serverAnswers(401, { error: { code: 'unauthenticated' } });
		await camera();
		await shoot();
		await readButton().click();
		await expect.element(page.getByText(/needs you to be signed in/)).toBeInTheDocument();
	});

	it('says the photo could not be sent when nothing answered', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			Promise.reject(new TypeError('Failed to fetch'))
		);
		await camera();
		await shoot();
		await readButton().click();
		await expect.element(page.getByText(/photo couldn’t be sent/)).toBeInTheDocument();
	});

	it('says it is reading while the still is with the server', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
		await camera();
		await shoot();
		await readButton().click();
		await expect.element(page.getByRole('button', { name: 'Reading the plate…' })).toBeDisabled();
	});

	it('clears the last refusal when the picture is retaken', async () => {
		serverAnswers(503, { error: { code: 'photo-unavailable' } });
		await camera();
		await shoot();
		await readButton().click();
		await expect
			.element(page.getByText(/Photo logging isn’t available right now/))
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Retake' }).click();
		expect(document.body.textContent).not.toContain('Photo logging isn’t available');
	});
});

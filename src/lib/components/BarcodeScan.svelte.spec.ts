import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { CatalogFoodPayload } from '$lib/domain/catalog-food';
import { paintingStream, stopPainting, stubMediaDevices } from '$lib/testing/fixtures';
import BarcodeScan from './BarcodeScan.svelte';

/** Long enough for the viewfinder to receive a frame and the scan timer to fire. */
const SCAN = { timeout: 5000 };

const OFF_SHELF = '00016000275287';

const CEREAL: CatalogFoodPayload = {
	id: 4213,
	name: 'HONEY NUT CHEERIOS',
	brand: 'GENERAL MILLS',
	kind: 'branded',
	category: 'Breakfast Cereals',
	barcode: OFF_SHELF,
	license: 'PDDL-1.0',
	serving: { label: '3/4 cup', grams: 37 },
	per100g: {
		kcal: 375,
		protein: 8.1,
		fat: 4.5,
		carbs: 78.4,
		sugar: 24.3,
		fiber: 8.1,
		sodium: 500,
		saturatedFat: 0.7
	}
};

function cameraOpens() {
	stubMediaDevices({ getUserMedia: vi.fn(() => Promise.resolve(paintingStream())) });
}

function cameraFails(name: string) {
	stubMediaDevices({
		getUserMedia: vi.fn(() => Promise.reject(new DOMException('no', name)))
	});
}

/** An engine that reads `code` out of every frame, or none at all when null. */
function detectorReading(code: string | null) {
	Object.defineProperty(globalThis, 'BarcodeDetector', {
		configurable: true,
		writable: true,
		value: class {
			detect() {
				return Promise.resolve(code === null ? [] : [{ rawValue: code }]);
			}
		}
	});
}

function serverAnswers(status: number, body?: unknown) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
		Promise.resolve(
			new Response(body === undefined ? null : JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			})
		)
	);
}

async function mount() {
	const onpick = vi.fn();
	const onsearch = vi.fn();
	await render(BarcodeScan, { props: { onpick, onsearch } });
	return { onpick, onsearch };
}

const digits = () => page.getByLabelText('Barcode digits');

async function type(code: string) {
	await digits().fill(code);
	await page.getByRole('button', { name: 'Look it up' }).click();
}

afterEach(() => {
	stopPainting();
	Reflect.deleteProperty(navigator, 'mediaDevices');
	Reflect.deleteProperty(globalThis, 'BarcodeDetector');
	vi.restoreAllMocks();
});

describe('BarcodeScan', () => {
	it('reads a barcode off the camera and proposes the food it names', async () => {
		cameraOpens();
		detectorReading(OFF_SHELF);
		serverAnswers(200, { barcode: OFF_SHELF, ambiguous: false, foods: [CEREAL] });
		const { onpick } = await mount();
		await vi.waitFor(() => expect(onpick).toHaveBeenCalledOnce(), SCAN);
		expect(onpick.mock.calls[0]?.[0]).toMatchObject({
			name: 'HONEY NUT CHEERIOS',
			kcal: 139
		});
	});

	it('never picks silently between two foods carrying one barcode', async () => {
		cameraOpens();
		detectorReading(OFF_SHELF);
		serverAnswers(200, {
			barcode: OFF_SHELF,
			ambiguous: true,
			foods: [CEREAL, { ...CEREAL, id: 9001, name: 'HONEY NUT CHEERIOS, FAMILY SIZE' }]
		});
		const { onpick } = await mount();
		await expect
			.element(page.getByText('That barcode names more than one food.'), SCAN)
			.toBeInTheDocument();
		expect(onpick).not.toHaveBeenCalled();
		await page.getByRole('button', { name: /FAMILY SIZE/ }).click();
		expect(onpick).toHaveBeenCalledOnce();
		expect(onpick.mock.calls[0]?.[0]).toMatchObject({ name: 'HONEY NUT CHEERIOS, FAMILY SIZE' });
	});

	it('offers the digits to type when this engine cannot read barcodes', async () => {
		cameraOpens();
		serverAnswers(200, { barcode: OFF_SHELF, ambiguous: false, foods: [CEREAL] });
		const { onpick } = await mount();
		await expect
			.element(page.getByText('This device can’t read a barcode with its camera.'), SCAN)
			.toBeInTheDocument();
		await type(OFF_SHELF);
		await vi.waitFor(() => expect(onpick).toHaveBeenCalledOnce());
	});

	it('leaves typing available when camera access is declined', async () => {
		cameraFails('NotAllowedError');
		detectorReading(OFF_SHELF);
		serverAnswers(200, { barcode: OFF_SHELF, ambiguous: false, foods: [CEREAL] });
		const { onpick } = await mount();
		await expect.element(page.getByText('Camera access was declined.'), SCAN).toBeInTheDocument();
		await type(OFF_SHELF);
		await vi.waitFor(() => expect(onpick).toHaveBeenCalledOnce());
	});

	it('says so when there is no camera to open at all', async () => {
		stubMediaDevices(undefined);
		detectorReading(OFF_SHELF);
		await mount();
		await expect.element(page.getByText('No camera answered here.'), SCAN).toBeInTheDocument();
	});

	it('names the digits it could not place and offers a search by name', async () => {
		cameraFails('NotAllowedError');
		detectorReading(null);
		serverAnswers(404);
		const { onsearch } = await mount();
		await type(OFF_SHELF);
		await expect
			.element(page.getByText(`Nothing in the catalog carries ${OFF_SHELF}.`), SCAN)
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Search by name' }).click();
		expect(onsearch).toHaveBeenCalledOnce();
	});

	it('says the catalog is out of reach rather than that the food does not exist', async () => {
		cameraFails('NotAllowedError');
		detectorReading(null);
		serverAnswers(503);
		await mount();
		await type(OFF_SHELF);
		await expect
			.element(page.getByText('The full catalog is out of reach right now.'), SCAN)
			.toBeInTheDocument();
	});

	it('tells a signed-out device there is nothing to check the code against', async () => {
		// #146 removed the two bundled packages that used to answer offline, so
		// the old "only the foods bundled with the app answer" is no longer true.
		cameraFails('NotAllowedError');
		detectorReading(null);
		serverAnswers(401);
		await mount();
		await type(OFF_SHELF);
		await expect
			.element(page.getByText('Sign in to reach the food catalog.'), SCAN)
			.toBeInTheDocument();
	});

	it('refuses digits that are not a barcode without asking the server', async () => {
		cameraFails('NotAllowedError');
		detectorReading(null);
		const fetching = serverAnswers(404);
		await mount();
		await type('1234');
		await expect.element(page.getByText('A barcode is 8 to 14 digits.'), SCAN).toBeInTheDocument();
		expect(fetching).not.toHaveBeenCalled();
	});

	it('goes back to the camera after a miss', async () => {
		cameraOpens();
		detectorReading(null);
		serverAnswers(404);
		await mount();
		await type(OFF_SHELF);
		await expect.element(page.getByRole('button', { name: 'Scan again' }), SCAN).toBeVisible();
		await page.getByRole('button', { name: 'Scan again' }).click();
		await expect.element(page.getByLabelText('Barcode viewfinder'), SCAN).toBeInTheDocument();
	});
});

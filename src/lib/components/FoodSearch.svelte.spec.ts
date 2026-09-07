import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { CatalogFoodPayload } from '$lib/domain/catalog-food';
import { FOODS } from '$lib/domain/foods';
import FoodSearch from './FoodSearch.svelte';

const SEARCH = 'Search foods, brands, barcodes';

/** Longer than the debounce, so a request has gone out and come back. */
const ANSWERED = { timeout: 4000 };

function row(id: number, name: string): CatalogFoodPayload {
	return {
		id,
		name,
		brand: 'CATALOG BRAND',
		kind: 'branded',
		category: 'Poultry',
		barcode: null,
		license: 'PDDL-1.0',
		serving: { label: '100 g', grams: 100 },
		per100g: {
			kcal: 165,
			protein: 31,
			fat: 3.6,
			carbs: 0,
			sugar: 0,
			fiber: 0,
			sodium: 74,
			saturatedFat: 1
		}
	};
}

const THIGH = row(2, 'CATALOG CHICKEN THIGH');
const BREAST = row(1, 'CATALOG CHICKEN BREAST');

function jsonResponse(status: number, body?: unknown) {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** The catalog answers every search the same way. */
function catalogAnswers(status: number, body?: unknown) {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(() => Promise.resolve(jsonResponse(status, body)));
}

/** The catalog is asked but never answers, which is what "still searching" looks like. */
function catalogSilent() {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
}

beforeEach(() => {
	// Nothing here talks to a real server: every spec below decides what the
	// catalog says, and the default is a deployment that has no catalog file.
	catalogAnswers(503);
});

afterEach(() => vi.restoreAllMocks());

describe('FoodSearch', () => {
	it('offers a starter list before anything is typed', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		expect(document.querySelectorAll('li').length).toBeGreaterThan(0);
	});

	it('narrows the list as you type', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		const before = document.querySelectorAll('li').length;
		await page.getByLabelText(SEARCH).fill('chicken breast');
		expect(document.querySelectorAll('li').length).toBeLessThan(before);
	});

	it('finds a packaged food by its barcode', async () => {
		const barcoded = FOODS.find((f) => f.barcode);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill(barcoded?.barcode ?? '');
		await expect.element(page.getByText(barcoded?.name ?? '')).toBeInTheDocument();
	});

	it('hands the chosen food to the caller', async () => {
		const onpick = vi.fn();
		await render(FoodSearch, { props: { onpick } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await page.getByRole('button').first().click();
		expect(onpick).toHaveBeenCalledWith(expect.objectContaining({ id: 'chicken-breast' }));
	});

	it('explains itself rather than going blank when nothing matches', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('qqqzzz');
		await expect.element(page.getByText(/Nothing in the catalog/)).toBeInTheDocument();
	});

	it('accepts a custom placeholder', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn(), placeholder: 'Find a catalog match' } });
		await expect.element(page.getByPlaceholder('Find a catalog match')).toBeInTheDocument();
	});

	it('shows per-serving energy alongside each result', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText(/kcal/).first()).toBeInTheDocument();
	});

	it('keeps the provenance badge from wrapping when the name truncates', async () => {
		// Regression: a long name (e.g. "Chicken burrito bowl") and a two-word
		// badge ("Brand published") shared a row with no min-w-0 on the name or
		// shrink-0 on the badge, so the badge wrapped to two lines and made that
		// row taller than its neighbors.
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('burrito');
		const name = document.body.querySelector<HTMLElement>('p.truncate');
		expect(name?.className).toMatch(/\bmin-w-0\b/);
		const badge = page.getByText('Brand published');
		await expect.element(badge).toBeInTheDocument();
		const badgeWrapper = badge.element().closest('span.shrink-0');
		expect(badgeWrapper).not.toBeNull();
	});

	it('shows the bundled foods immediately while the catalog is still answering', async () => {
		catalogSilent();
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		// No await on the network: the bundled row is on screen from the keystroke.
		await expect.element(page.getByText('Chicken breast, grilled')).toBeInTheDocument();
		await expect.element(page.getByText(/Searching the full catalog/)).toBeInTheDocument();
	});

	it('adds the catalog matches under the bundled ones once they land', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText('CATALOG CHICKEN BREAST'), ANSWERED).toBeInTheDocument();
		// The hand-written row keeps its place at the top rather than being replaced.
		const names = [...document.querySelectorAll('li p.font-medium')].map((p) => p.textContent);
		expect(names[0]).toBe('Chicken breast, grilled');
		expect(names).toContain('CATALOG CHICKEN BREAST');
	});

	it('logs a catalog food the caller can use, scaled onto its serving', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		const onpick = vi.fn();
		await render(FoodSearch, { props: { onpick } });
		await page.getByLabelText(SEARCH).fill('kumquat');
		const hit = page.getByRole('button', { name: /CATALOG CHICKEN BREAST/ });
		await expect.element(hit, ANSWERED).toBeInTheDocument();
		await hit.click();
		expect(onpick).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'catalog-1', name: 'CATALOG CHICKEN BREAST', kcal: 165 })
		);
	});

	it('does not ask the catalog for fewer than three characters, and says why', async () => {
		const fetching = catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('ch');
		await expect.element(page.getByText(/searched from three letters/)).toBeInTheDocument();
		expect(fetching).not.toHaveBeenCalled();
	});

	it('sends one request for a burst of keystrokes rather than one each', async () => {
		const fetching = catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		const box = page.getByLabelText(SEARCH);
		await box.fill('chi');
		await box.fill('chic');
		await box.fill('chicken');
		await expect.element(page.getByText('CATALOG CHICKEN BREAST'), ANSWERED).toBeInTheDocument();
		expect(fetching).toHaveBeenCalledOnce();
		expect(fetching.mock.calls[0]?.[0]).toBe('/api/foods?q=chicken');
	});

	it('says the catalog is out of reach, and still searches the bundled foods', async () => {
		catalogAnswers(503);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByText(/the full catalog is out of reach/), ANSWERED)
			.toBeVisible();
		await expect.element(page.getByText('Chicken breast, grilled')).toBeInTheDocument();
	});

	it('says the same thing offline as it does when the catalog is missing', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			Promise.reject(new TypeError('Failed to fetch'))
		);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByText(/the full catalog is out of reach/), ANSWERED)
			.toBeVisible();
	});

	it('asks a signed-out person to sign in rather than saying there is no such food', async () => {
		catalogAnswers(401);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByText(/Sign in to search the full catalog/), ANSWERED)
			.toBeVisible();
	});

	it('says the catalog was read and holds nothing, which is not a failure', async () => {
		catalogAnswers(200, { foods: [] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByText(/Nothing else in the full catalog matches/), ANSWERED)
			.toBeVisible();
	});

	it('never lets a slower earlier query overwrite the results for what is typed now', async () => {
		// "chicken" scores far more catalog rows than "chicken thigh", so its
		// request really can land second. Without the guard in food-search, the
		// list would settle on results for text the person has moved past.
		let releaseBroad: () => void = () => undefined;
		const fetching = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
			// The component only ever passes a string; anything else is not a query.
			const url = typeof input === 'string' ? input : '';
			if (url.endsWith('q=chicken')) {
				return new Promise<Response>((done) => {
					releaseBroad = () => done(jsonResponse(200, { foods: [BREAST] }));
				});
			}
			return Promise.resolve(jsonResponse(200, { foods: [THIGH] }));
		});

		await render(FoodSearch, { props: { onpick: vi.fn() } });
		const box = page.getByLabelText(SEARCH);
		await box.fill('chicken');
		// The broad request has to be in flight, or there is no race to guard.
		await vi.waitFor(() => expect(fetching).toHaveBeenCalledOnce(), ANSWERED);
		await box.fill('chicken thigh');
		await expect.element(page.getByText('CATALOG CHICKEN THIGH'), ANSWERED).toBeInTheDocument();

		releaseBroad();
		await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(2), ANSWERED);
		await new Promise((settle) => setTimeout(settle, 50));
		expect(document.body.textContent).toContain('CATALOG CHICKEN THIGH');
		expect(document.body.textContent).not.toContain('CATALOG CHICKEN BREAST');
	});
});

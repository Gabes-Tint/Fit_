import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { CatalogFoodPayload } from '$lib/domain/catalog-food';
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
			saturatedFat: 1,
			potassium: 256
		}
	};
}

const THIGH = row(2, 'CATALOG CHICKEN THIGH');
const BREAST = row(1, 'CATALOG CHICKEN BREAST');
/** Long enough to make the name truncate beside a two-word provenance badge. */
const BURRITO = row(3, 'CATALOG CHICKEN BURRITO BOWL, EXTRA LARGE');

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
	it('says where every food comes from before anything is typed', async () => {
		// #146 took the bundled table away, so the resting state has no rows to
		// offer. Saying the catalog is the only source beats an empty box that
		// looks broken -- and it is the honest answer on a plane.
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		expect(document.querySelectorAll('li').length).toBe(0);
		await expect
			.element(
				page.getByText('Every food comes from the full catalog, so searching needs a connection.')
			)
			.toBeInTheDocument();
	});

	it('hands the chosen food to the caller', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		const onpick = vi.fn();
		await render(FoodSearch, { props: { onpick } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		const hit = page.getByRole('button', { name: /CATALOG CHICKEN BREAST/ }).first();
		await expect.element(hit, ANSWERED).toBeInTheDocument();
		await hit.click();
		expect(onpick).toHaveBeenCalledWith(expect.objectContaining({ id: 'catalog-1' }));
	});

	it('explains itself rather than going blank when nothing matches', async () => {
		catalogAnswers(200, { foods: [] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('qqqzzz');
		await expect
			.element(page.getByText(/Nothing in the full catalog matches that/), ANSWERED)
			.toBeInTheDocument();
	});

	it('offers a direct-log button per row when the caller asks for it', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		const onpick = vi.fn();
		const ondirectlog = vi.fn();
		await render(FoodSearch, { props: { onpick, ondirectlog } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		const plus = page.getByRole('button', { name: 'Log CATALOG CHICKEN BREAST' });
		await expect.element(plus, ANSWERED).toBeInTheDocument();
		await plus.click();
		expect(ondirectlog).toHaveBeenCalledWith(expect.objectContaining({ id: 'catalog-1' }));
		// Tapping the row itself must still only propose -- the `+` is an
		// alternative, not a replacement for the existing tap-to-propose flow.
		expect(onpick).not.toHaveBeenCalled();
	});

	it('gives the direct-log button and the nutrition-facts button distinct names', async () => {
		// Regression: both buttons sit in the same row. If their accessible
		// names collided, a screen reader (and a test locator) could not tell
		// "log this" from "show me its nutrition facts".
		catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn(), ondirectlog: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByRole('button', { name: 'Log CATALOG CHICKEN BREAST' }), ANSWERED)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Nutrition facts for CATALOG CHICKEN BREAST' }))
			.toBeInTheDocument();
	});

	it('has no direct-log button when the caller does not pass one', async () => {
		// ProposalRow mounts this component to find a catalog match for an
		// already-typed item -- tapping a row there resolves that item, and a
		// second way to log it outright would be a second, contradictory action.
		catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(page.getByRole('button', { name: /CATALOG CHICKEN BREAST/ }).first(), ANSWERED)
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: /^Log / }).elements().length).toBe(0);
	});

	it('accepts a custom placeholder', async () => {
		await render(FoodSearch, { props: { onpick: vi.fn(), placeholder: 'Find a catalog match' } });
		await expect.element(page.getByPlaceholder('Find a catalog match')).toBeInTheDocument();
	});

	it('shows per-serving energy alongside each result', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText(/kcal/).first(), ANSWERED).toBeInTheDocument();
	});

	it('keeps the provenance badge from wrapping when the name truncates', async () => {
		// Regression: a long name (e.g. "Chicken burrito bowl") and a two-word
		// badge ("Brand published") shared a row with no min-w-0 on the name or
		// shrink-0 on the badge, so the badge wrapped to two lines and made that
		// row taller than its neighbors.
		catalogAnswers(200, { foods: [BURRITO] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('burrito');
		await expect
			.element(page.getByText('CATALOG CHICKEN BURRITO BOWL, EXTRA LARGE'), ANSWERED)
			.toBeInTheDocument();
		const name = document.body.querySelector<HTMLElement>('p.truncate');
		expect(name?.className).toMatch(/\bmin-w-0\b/);
		const badge = page.getByText('Brand published');
		await expect.element(badge).toBeInTheDocument();
		const badgeWrapper = badge.element().closest('span.shrink-0');
		expect(badgeWrapper).not.toBeNull();
	});

	it('says a request is out while the catalog is still answering', async () => {
		catalogSilent();
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText(/Searching the full catalog/)).toBeInTheDocument();
		// Nothing is listed before the answer: there is no local table to show.
		expect(document.querySelectorAll('li').length).toBe(0);
	});

	it('lists the catalog matches once they land', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText('CATALOG CHICKEN BREAST'), ANSWERED).toBeInTheDocument();
		const names = [...document.querySelectorAll('li p.font-medium')].map((p) => p.textContent);
		expect(names).toEqual(['CATALOG CHICKEN BREAST']);
	});

	it('logs a catalog food the caller can use, scaled onto its serving', async () => {
		catalogAnswers(200, { foods: [BREAST] });
		const onpick = vi.fn();
		await render(FoodSearch, { props: { onpick } });
		await page.getByLabelText(SEARCH).fill('kumquat');
		const hit = page.getByRole('button', { name: /CATALOG CHICKEN BREAST/ }).first();
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

	it('says search needs a connection when the catalog is out of reach', async () => {
		// The regression #146 has to not introduce: with the bundled rows gone,
		// an unreachable catalog leaves an empty list, and an empty list on its
		// own reads as "no such food". It has to say what actually happened.
		catalogAnswers(503);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect
			.element(
				page.getByText(
					'Search needs a connection, and the full catalog is out of reach right now. Try again in a moment.'
				),
				ANSWERED
			)
			.toBeVisible();
	});

	it('never suggests another spelling when the catalog was never read', async () => {
		// "Try a different spelling" is a claim the food is not in the catalog.
		// Offline, nothing knows that -- the request never got an answer.
		catalogAnswers(503);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText(/out of reach right now/), ANSWERED).toBeVisible();
		expect(document.body.textContent).not.toContain('Try a different spelling');
	});

	it('says the same thing offline as it does when the catalog is missing', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			Promise.reject(new TypeError('Failed to fetch'))
		);
		await render(FoodSearch, { props: { onpick: vi.fn() } });
		await page.getByLabelText(SEARCH).fill('chicken breast');
		await expect.element(page.getByText(/Search needs a connection/), ANSWERED).toBeVisible();
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
			.element(page.getByText(/Nothing in the full catalog matches/), ANSWERED)
			.toBeVisible();
		// Regression: this used to say "You can still log it as custom from
		// text.", which was never true -- commit() (LogSheet.svelte) drops every
		// unmatched proposal. What follows now is something the person can
		// actually do next.
		await expect
			.element(page.getByText('Try a different spelling, or scan the barcode instead.'))
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

	describe('the nutrition facts sheet', () => {
		it('opens with the food’s name as its title when the ⓘ is tapped', async () => {
			catalogAnswers(200, { foods: [BREAST] });
			await render(FoodSearch, { props: { onpick: vi.fn() } });
			await page.getByLabelText(SEARCH).fill('kumquat');
			const info = page.getByLabelText(/Nutrition facts for CATALOG CHICKEN BREAST/);
			await expect.element(info, ANSWERED).toBeInTheDocument();
			await info.click();
			await expect
				.element(page.getByRole('heading', { name: 'CATALOG CHICKEN BREAST' }))
				.toBeInTheDocument();
		});

		it('shows the catalog’s sodium and potassium for the serving', async () => {
			catalogAnswers(200, { foods: [BREAST] });
			await render(FoodSearch, { props: { onpick: vi.fn() } });
			await page.getByLabelText(SEARCH).fill('kumquat');
			const info = page.getByLabelText(/Nutrition facts for CATALOG CHICKEN BREAST/);
			await expect.element(info, ANSWERED).toBeInTheDocument();
			await info.click();
			await expect.element(page.getByText('Sodium')).toBeInTheDocument();
			await expect.element(page.getByText('74 mg')).toBeInTheDocument();
			await expect.element(page.getByText('Potassium')).toBeInTheDocument();
			await expect.element(page.getByText('256 mg')).toBeInTheDocument();
		});

		it('does not hand the row to the caller when the ⓘ is tapped', async () => {
			catalogAnswers(200, { foods: [BREAST] });
			const onpick = vi.fn();
			await render(FoodSearch, { props: { onpick } });
			await page.getByLabelText(SEARCH).fill('kumquat');
			const info = page.getByLabelText(/Nutrition facts for CATALOG CHICKEN BREAST/);
			await expect.element(info, ANSWERED).toBeInTheDocument();
			await info.click();
			expect(onpick).not.toHaveBeenCalled();
		});

		it('is a real button a keyboard can focus and activate', async () => {
			catalogAnswers(200, { foods: [BREAST] });
			await render(FoodSearch, { props: { onpick: vi.fn() } });
			await page.getByLabelText(SEARCH).fill('kumquat');
			const info = page.getByLabelText(/Nutrition facts for CATALOG CHICKEN BREAST/);
			await expect.element(info, ANSWERED).toBeInTheDocument();
			const el = info.element() as HTMLButtonElement;
			el.focus();
			expect(document.activeElement).toBe(el);
			// A native `<button>` answers Enter/Space with its own click event.
			el.click();
			await expect
				.element(page.getByRole('heading', { name: 'CATALOG CHICKEN BREAST' }))
				.toBeInTheDocument();
		});
	});
});

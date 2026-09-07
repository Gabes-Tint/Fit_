import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Toasts are the sheet's only way of saying what it did with a row it could not
 * log, and nothing here mounts a `Toaster` — `AppShell` owns that — so they are
 * recorded rather than read off the DOM. Same shape as `sync.svelte.spec.ts`.
 */
const announced = vi.hoisted(() => [] as string[]);
vi.mock('svelte-sonner', () => ({
	toast: (message: string) => {
		announced.push(message);
	}
}));
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { emptyProfile } from '$lib/domain/profile';
import { guessMeal } from '$lib/domain/parse-text';
import { logUi } from '$lib/state/log-ui.svelte';
import { tend } from '$lib/state/tend.svelte';
import LogSheet from './LogSheet.svelte';

const OFF_SHELF = '00016000275287';

/** One catalog row in the shape `/api/foods/barcode` sends it. */
const CEREAL = {
	id: 4213,
	name: 'HONEY NUT CHEERIOS',
	brand: 'GENERAL MILLS',
	kind: 'branded',
	category: 'Breakfast Cereals',
	barcode: '00016000275287',
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

/**
 * The rows `/api/foods/resolve` answers typed names with. Since #116 nothing
 * typed is matched on the device, and since #146 there is no device table left
 * for it to be matched against.
 */
const EGG = {
	id: 101,
	name: 'Egg, large',
	brand: null,
	kind: 'generic',
	category: 'Dairy and Egg Products',
	barcode: null,
	license: 'PDDL-1.0',
	serving: { label: '1 large', grams: 50 },
	per100g: {
		kcal: 144,
		protein: 12.6,
		fat: 9.6,
		carbs: 0.8,
		sugar: 0.4,
		fiber: 0,
		sodium: 142,
		saturatedFat: 3
	}
};

const BANANA = {
	...EGG,
	id: 102,
	name: 'Banana',
	category: 'Fruits',
	serving: { label: '1 medium', grams: 118 },
	per100g: { ...EGG.per100g, kcal: 89 }
};

/** 14 g and 119 kcal a tablespoon, so "2 tbsp" is two servings and 238 kcal. */
const OLIVE_OIL = {
	...EGG,
	id: 103,
	name: 'Olive oil',
	category: 'Fats and Oils',
	serving: { label: '1 tbsp', grams: 14 },
	per100g: { ...EGG.per100g, kcal: 850 }
};

const CHICKEN = {
	...EGG,
	id: 104,
	name: 'Chicken breast, grilled',
	category: 'Poultry',
	serving: { label: '100 g', grams: 100 },
	per100g: { ...EGG.per100g, kcal: 165 }
};

// Local, not `$lib/testing/fixtures`' `jsonResponse`: every caller here wants a resolved
// promise of a 200, never a status or header override, so the narrower signature stays.
function jsonResponse(body: unknown) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		})
	);
}

function urlOf(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.href : input.url;
}

/** The names one intercepted request asked about, or none when it asked about nothing. */
function queriesIn(init: RequestInit | undefined): string[] {
	const raw = typeof init?.body === 'string' ? init.body : '{}';
	return (JSON.parse(raw) as { queries?: string[] }).queries ?? [];
}

/**
 * The server as the sheet sees it.
 *
 * `/api/foods/resolve` answers with `rows`, one per name in the order they were
 * asked, and `null` for anything past the end of the list. Every other call —
 * the search box that a proposal row opens — answers with no catalog rows, so
 * that box lists nothing.
 */
function resolvesTo(...rows: (object | null)[]) {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
			if (!urlOf(input).includes('/api/foods/resolve')) return jsonResponse({ foods: [] });
			const queries = queriesIn(init);
			return jsonResponse({
				items: queries.map((query, index) => ({
					query,
					food: rows[index] ?? null,
					alternatives: []
				}))
			});
		});
}

/**
 * The search box finding one catalog row, with `/api/foods/resolve` matching
 * nothing. Since #146 the box has no device-side table behind it, so a test that
 * clicks a search result has to say what the server returned.
 */
function searchFinds(row: object) {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
			if (!urlOf(input).includes('/api/foods/resolve')) return jsonResponse({ foods: [row] });
			return jsonResponse({
				items: queriesIn(init).map((query) => ({ query, food: null, alternatives: [] }))
			});
		});
}

/** The resolve endpoint refusing, with everything else answering as usual. */
function resolveRefuses(status: number) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
		if (!urlOf(input).includes('/api/foods/resolve')) return jsonResponse({ foods: [] });
		return Promise.resolve(new Response(null, { status }));
	});
}

/** One resolve request held open, so a later one can be answered before it. */
type Pending = { queries: string[]; settle: (response: Response) => void };

function answerWith(call: Pending | undefined, row: object) {
	if (!call) throw new Error('no resolve request was waiting');
	call.settle(
		new Response(
			JSON.stringify({
				items: call.queries.map((query) => ({ query, food: row, alternatives: [] }))
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)
	);
}

/** A stream with real frames: a canvas can produce one without a camera. */
function fakeStream() {
	const canvas = document.createElement('canvas');
	canvas.width = 320;
	canvas.height = 240;
	return canvas.captureStream(1);
}

function onboard() {
	tend.resetAll();
	tend.completeOnboarding({
		profile: emptyProfile({ name: 'Alex' }),
		household: false,
		useSample: false
	});
}

async function openSheet() {
	await render(LogSheet);
	logUi.open = true;
	await expect.element(page.getByRole('dialog')).toBeInTheDocument();
}

afterEach(() => {
	delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
});

beforeEach(() => {
	localStorage.clear();
	logUi.open = false;
	logUi.tab = 'type';
	logUi.meal = null;
	vi.restoreAllMocks();
	announced.length = 0;
	onboard();
});

describe('LogSheet', () => {
	it('stays closed until asked', async () => {
		await render(LogSheet);
		expect(document.body.textContent).not.toContain('Tend proposes');
	});

	it('states its contract when opened', async () => {
		await openSheet();
		expect(document.body.textContent).toContain('Tend proposes. You correct in one tap.');
	});

	it('opens on the typing tab', async () => {
		await openSheet();
		await expect
			.element(page.getByPlaceholder('two eggs, toast, black coffee'))
			.toBeInTheDocument();
	});

	it('opens on the search tab by default, not the typing tab', async () => {
		await render(LogSheet);
		logUi.show();
		await expect
			.element(page.getByPlaceholder('Search foods, brands, barcodes'))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Search', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('lists Search first among the tabs', async () => {
		await render(LogSheet);
		logUi.show();
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		const tabs = page.getByRole('button', { name: /^(Search|Type|Photo|Upload|Voice|Scan)$/ });
		expect(tabs.elements()[0]?.textContent?.trim()).toBe('Search');
	});

	it('opens on the photo tab when the camera asked for it', async () => {
		await render(LogSheet);
		logUi.show('photo');
		await expect
			.element(page.getByRole('button', { name: 'Photo', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('returns to typing once it has been closed', async () => {
		await render(LogSheet);
		logUi.show('photo');
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Close' }).click();
		expect(logUi.tab).toBe('type');
	});

	it('will not parse an empty sentence', async () => {
		await openSheet();
		await expect.element(page.getByRole('button', { name: 'Parse' })).toBeDisabled();
	});

	it('proposes items parsed from a sentence, named by the server', async () => {
		resolvesTo(EGG);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText(/Proposed/)).toBeInTheDocument();
		await expect.element(page.getByText('Egg, large').first()).toBeInTheDocument();
	});

	it('asks the server once for every food the sentence held', async () => {
		const fetching = resolvesTo(EGG, BANANA);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs, one banana');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('Banana').first()).toBeInTheDocument();
		const asks = fetching.mock.calls.filter(([input]) =>
			urlOf(input).includes('/api/foods/resolve')
		);
		expect(asks).toHaveLength(1);
		expect(queriesIn(asks[0]?.[1])).toEqual(['eggs', 'banana']);
	});

	it('leaves a name the catalog had nothing for to be matched by hand', async () => {
		resolvesTo(null);
		await openSheet();
		await page.getByLabelText('What you ate').fill('xyzzy nonexistent gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('xyzzy nonexistent gruel').first()).toBeInTheDocument();
	});

	it('keeps what was typed, and logs nothing, when the server cannot be reached', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('offline')));
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		// The row is still there, with the words that were typed, so nothing the
		// person wrote is lost to a dropped connection.
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('eggs').first()).toBeInTheDocument();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).not.toHaveBeenCalled();
	});

	it('leaves the rows unmatched when the catalog refuses the session', async () => {
		resolveRefuses(401);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
	});

	it('resolves a phrase longer than the endpoint accepts, and the rows beside it', async () => {
		// Regression: the client capped the number of names but not their length,
		// so one long phrase was refused with the whole body and every row in the
		// sentence came back as "matching needs the server".
		const long =
			'1 bowl homemade slow cooked spicy moroccan chickpea sweet potato and red lentil stew with preserved lemon';
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		resolvesTo(CHICKEN, EGG);
		await openSheet();
		await page.getByLabelText('What you ate').fill(`${long}, two eggs`);
		await page.getByRole('button', { name: 'Parse' }).click();

		await expect.element(page.getByText('Chicken breast, grilled').first()).toBeInTheDocument();
		await expect.element(page.getByText('Egg, large').first()).toBeInTheDocument();
		expect(announced.some((line) => line.includes('Matching needs the server'))).toBe(false);
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]).toHaveLength(2);
	});

	it('says how many rows it could not log when only some had a food', async () => {
		// Regression: `commit` dropped every row with no catalog food and said
		// only how many it added, so the third item vanished with the sheet.
		vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		resolvesTo(EGG, BANANA, null);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs, one banana, xyzzy gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('Banana').first()).toBeInTheDocument();

		await page.getByRole('button', { name: 'Add to today' }).click();
		await vi.waitFor(() =>
			expect(announced).toContain(
				'1 item had no catalog food and was not logged — match each item to a catalog food first.'
			)
		);
		expect(announced).toContain('Added 2 items.');
	});

	it('says nothing about skipped rows when every row was logged', async () => {
		vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		resolvesTo(EGG, BANANA);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs, one banana');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('Banana').first()).toBeInTheDocument();

		await page.getByRole('button', { name: 'Add to today' }).click();
		await vi.waitFor(() => expect(announced).toContain('Added 2 items.'));
		expect(announced.some((line) => line.includes('had no catalog food'))).toBe(false);
	});

	it('lets the second submission win when the first is still in flight', async () => {
		// A first answer landing after a second sentence was submitted would put
		// one sentence's foods against the other sentence's words.
		const waiting: Pending[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				if (!urlOf(input).includes('/api/foods/resolve')) return jsonResponse({ foods: [] });
				const queries = queriesIn(init);
				return new Promise<Response>((settle) => {
					waiting.push({ queries, settle });
				});
			}
		);

		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await vi.waitFor(() => expect(waiting).toHaveLength(1));
		await page.getByLabelText('What you ate').fill('one banana');
		await page.getByRole('button', { name: 'Parse' }).click();
		await vi.waitFor(() => expect(waiting).toHaveLength(2));

		// The newer request answers first, the older one afterwards.
		answerWith(waiting[1], BANANA);
		answerWith(waiting[0], EGG);
		await expect.element(page.getByText('Banana').first()).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Egg, large');
	});

	it('always offers typing as the way out of the photo tab', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Photo' }).click();
		await expect.element(page.getByRole('button', { name: 'Type it instead' })).toBeInTheDocument();
	});

	it('opens the camera straight away on the photo tab', async () => {
		const stream = fakeStream();
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) }
		});
		await openSheet();
		await page.getByRole('button', { name: 'Photo' }).click();
		await expect.element(page.getByLabelText('Camera viewfinder')).toBeInTheDocument();
	});

	it('keeps the gallery as its own way in, beside the camera', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Upload' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Choose a picture' }))
			.toBeInTheDocument();
	});

	it('sends the user back to typing from the photo tab', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Photo' }).click();
		await page.getByRole('button', { name: 'Type it instead' }).click();
		await expect
			.element(page.getByPlaceholder('two eggs, toast, black coffee'))
			.toBeInTheDocument();
	});

	it('offers dictation on the voice tab', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Voice' }).click();
		await expect.element(page.getByRole('button', { name: 'Start listening' })).toBeInTheDocument();
	});

	it('no longer offers a hard-coded demo scan', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Scan' }).click();
		await expect.element(page.getByLabelText('Barcode digits')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Demo scan');
	});

	it('proposes and logs the food a typed barcode names', async () => {
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			jsonResponse({ barcode: OFF_SHELF, ambiguous: false, foods: [CEREAL] })
		);
		await openSheet();
		await page.getByRole('button', { name: 'Scan' }).click();
		await page.getByLabelText('Barcode digits').fill(OFF_SHELF);
		await page.getByRole('button', { name: 'Look it up' }).click();
		await expect.element(page.getByText('HONEY NUT CHEERIOS').first()).toBeInTheDocument();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).toHaveBeenCalledOnce();
		// The catalog's own id is not stored: the entry carries its own macros.
		expect(add.mock.calls[0]?.[0]?.[0]).toMatchObject({
			foodId: null,
			name: 'HONEY NUT CHEERIOS',
			kcal: 139
		});
	});

	it('offers the catalog on the search tab', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Search' }).click();
		await expect
			.element(page.getByPlaceholder('Search foods, brands, barcodes'))
			.toBeInTheDocument();
	});

	it('logs a food the search box found in the server catalog', async () => {
		// Regression: search handed a catalog food straight to `propose`, which
		// stores its id and nothing else. `commit` then found no food behind that
		// id and dropped the item, so nothing the search box returned could be
		// logged at all, and the sheet said only "match it first".
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ foods: [CEREAL] }));
		await openSheet();
		await page.getByRole('button', { name: 'Search' }).click();
		await page.getByLabelText('Search foods, brands, barcodes').fill('kumquat');
		const hit = page.getByRole('button', { name: /HONEY NUT CHEERIOS/ });
		await expect.element(hit, { timeout: 4000 }).toBeInTheDocument();
		await hit.click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).toHaveBeenCalledOnce();
		expect(add.mock.calls[0]?.[0]?.[0]).toMatchObject({
			foodId: null,
			name: 'HONEY NUT CHEERIOS',
			kcal: 139
		});
	});

	it('proposes a food chosen from search', async () => {
		searchFinds(CEREAL);
		await openSheet();
		await page.getByRole('button', { name: 'Search' }).click();
		await page.getByLabelText('Search foods, brands, barcodes').fill('chicken breast');
		await page.getByRole('button').filter({ hasText: 'kcal' }).first().click();
		await expect.element(page.getByText(/Proposed/)).toBeInTheDocument();
	});

	it('lets the meal be changed', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'dinner' }).click();
		await expect
			.element(page.getByRole('button', { name: 'dinner' }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('selects a meal chip in the same tone as every other selected pill', async () => {
		// Regression: this chip used tone="inverse" (black) while every other
		// selected pill in the app (Metric, household member, Search tab) uses the
		// default dark-green primary tone.
		await openSheet();
		await page.getByRole('button', { name: 'dinner' }).click();
		const chip = page.getByRole('button', { name: 'dinner' });
		await expect.element(chip).toHaveClass(/bg-primary/);
		await expect.element(chip).not.toHaveClass(/bg-foreground/);
	});

	it('opens with the meal chip named by whoever asked for it', async () => {
		await render(LogSheet);
		logUi.show('type', 'snack');
		await expect
			.element(page.getByRole('button', { name: 'snack' }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('falls back to the guessed meal when none was named', async () => {
		await render(LogSheet);
		logUi.show();
		await expect
			.element(page.getByRole('button', { name: guessMeal() }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('commits proposals to the log', async () => {
		resolvesTo(EGG);
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).toHaveBeenCalled();
	});

	it('logs the calories in the volume that was typed, not in one serving', async () => {
		// Olive oil is served by the tablespoon: 14 g, 119 kcal. Two tablespoons is
		// two servings, and logging one of them would be half the calories eaten.
		resolvesTo(OLIVE_OIL);
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('2 tbsp olive oil');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		const [logged] = add.mock.calls[0] ?? [];
		expect(logged?.[0]).toMatchObject({ name: 'Olive oil', servings: 2, kcal: 238 });
	});

	it('says how many millilitres the food’s serving is', async () => {
		resolvesTo(OLIVE_OIL);
		await openSheet();
		await page.getByLabelText('What you ate').fill('2 tbsp olive oil');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('1 tbsp (15 ml)')).toBeInTheDocument();
	});

	it('closes after committing', async () => {
		resolvesTo(EGG);
		vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(logUi.open).toBe(false);
	});

	it('refuses to log a proposal with no catalog food behind it', async () => {
		resolvesTo(null);
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('xyzzy nonexistent gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).not.toHaveBeenCalled();
	});

	it('drops a proposal when it is removed', async () => {
		resolvesTo(EGG);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page
			.getByRole('button', { name: /^Remove/ })
			.first()
			.click();
		expect(document.body.textContent).not.toContain('Proposed');
	});

	it('closes from the close control', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Close' }).click();
		expect(logUi.open).toBe(false);
	});

	it('matches a proposal to a catalog food', async () => {
		searchFinds(CEREAL);
		await openSheet();
		await page.getByLabelText('What you ate').fill('xyzzy nonexistent gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		await page.getByLabelText('Find a catalog match').fill('chicken breast');
		await page.getByRole('button').filter({ hasText: 'kcal' }).first().click();
		expect(document.body.textContent).not.toContain('Match to catalog');
	});

	it('adjusts a proposal’s servings before committing', async () => {
		resolvesTo(EGG);
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Increase' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).toHaveBeenCalledWith([expect.objectContaining({ servings: 2.5 })]);
	});

	it('commits every matched item in one go', async () => {
		resolvesTo(EGG, BANANA);
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs, one banana');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]).toHaveLength(2);
	});

	it('does not remount a proposal row when its own stepper is tapped', async () => {
		// Regression: keying the list by object identity would remount the very
		// row whose stepper was tapped, since `onchange` emits a fresh object for
		// that proposal. Keying by a stable id must leave the DOM node in place.
		resolvesTo(EGG);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText(/Proposed/)).toBeInTheDocument();
		const row = document.querySelector('li');
		await page.getByRole('button', { name: 'Increase' }).click();
		expect(document.querySelector('li')).toBe(row);
	});

	it('keeps the match panel on the same proposal when an earlier one is removed', async () => {
		// Regression #112: the panel was tracked by index. Removing an earlier
		// proposal shifted every later index, moving the open panel onto
		// whatever proposal now sits at that position instead of following the
		// proposal it was actually opened for.
		resolvesTo(EGG, BANANA, null, CHICKEN);
		await openSheet();
		await page
			.getByLabelText('What you ate')
			.fill('two eggs, one banana, xyzzy nonexistent gruel, chicken breast');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		await expect.element(page.getByLabelText('Find a catalog match')).toBeInTheDocument();

		await page
			.getByRole('button', { name: /^Remove/ })
			.first()
			.click();

		const panelRow = Array.from(document.querySelectorAll('li')).find((li) =>
			li.querySelector('input[placeholder="Find a catalog match"]')
		);
		expect(panelRow?.textContent).toContain('gruel');
		expect(panelRow?.textContent).not.toContain('chicken breast');
	});

	it('closes the match panel when the proposal it belongs to is removed', async () => {
		resolvesTo(EGG, null);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs, xyzzy nonexistent gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		await expect.element(page.getByLabelText('Find a catalog match')).toBeInTheDocument();

		await page
			.getByRole('button', { name: /^Remove/ })
			.nth(1)
			.click();

		expect(document.body.textContent).not.toContain('Find a catalog match');
	});

	it('puts the catalog search away when the match panel is closed again', async () => {
		resolvesTo(null);
		await openSheet();
		await page.getByLabelText('What you ate').fill('xyzzy nonexistent gruel');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		await expect.element(page.getByLabelText('Find a catalog match')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		expect(document.body.textContent).not.toContain('Find a catalog match');
	});

	it('says so when the browser cannot dictate', async () => {
		const globals = globalThis as unknown as {
			SpeechRecognition?: unknown;
			webkitSpeechRecognition?: unknown;
		};
		const native = globals.webkitSpeechRecognition;
		delete globals.SpeechRecognition;
		delete globals.webkitSpeechRecognition;
		try {
			await openSheet();
			await page.getByRole('button', { name: 'Voice' }).click();
			await page.getByRole('button', { name: 'Start listening' }).click();
			await expect
				.element(page.getByRole('button', { name: 'Start listening' }))
				.toBeInTheDocument();
		} finally {
			globals.webkitSpeechRecognition = native;
		}
	});

	it('listens, then stops when asked again', async () => {
		const globals = globalThis as unknown as { SpeechRecognition?: unknown };
		const stop = vi.fn();
		globals.SpeechRecognition = function Recognition() {
			return {
				lang: '',
				interimResults: true,
				start: vi.fn(),
				stop,
				onresult: null,
				onerror: null,
				onend: null
			};
		};
		try {
			await openSheet();
			await page.getByRole('button', { name: 'Voice' }).click();
			await page.getByRole('button', { name: 'Start listening' }).click();
			await page.getByRole('button', { name: 'Listening — tap to stop' }).click();
			expect(stop).toHaveBeenCalled();
		} finally {
			delete globals.SpeechRecognition;
		}
	});

	it('parses what was heard', async () => {
		resolvesTo(EGG);
		const globals = globalThis as unknown as { SpeechRecognition?: unknown };
		let instance: { onresult?: ((ev: unknown) => void) | null } = {};
		globals.SpeechRecognition = function Recognition() {
			instance = {
				lang: '',
				interimResults: true,
				start: vi.fn(),
				stop: vi.fn(),
				onresult: null,
				onerror: null,
				onend: null
			} as never;
			return instance;
		};
		try {
			await openSheet();
			await page.getByRole('button', { name: 'Voice' }).click();
			await page.getByRole('button', { name: 'Start listening' }).click();
			instance.onresult?.({ results: { 0: { 0: { transcript: 'two eggs' } } } });
			await expect.element(page.getByText(/Proposed/)).toBeInTheDocument();
		} finally {
			delete globals.SpeechRecognition;
		}
	});

	it('says so when it did not catch anything', async () => {
		const globals = globalThis as unknown as { SpeechRecognition?: unknown };
		let instance: { onerror?: (() => void) | null } = {};
		globals.SpeechRecognition = function Recognition() {
			instance = {
				lang: '',
				interimResults: true,
				start: vi.fn(),
				stop: vi.fn(),
				onresult: null,
				onerror: null,
				onend: null
			} as never;
			return instance;
		};
		try {
			await openSheet();
			await page.getByRole('button', { name: 'Voice' }).click();
			await page.getByRole('button', { name: 'Start listening' }).click();
			instance.onerror?.();
			await expect
				.element(page.getByRole('button', { name: 'Start listening' }))
				.toBeInTheDocument();
		} finally {
			delete globals.SpeechRecognition;
		}
	});
});

describe('LogSheet on GLP-1', () => {
	it('steps servings in quarters', async () => {
		resolvesTo(EGG);
		tend.resetAll();
		tend.completeOnboarding({
			profile: { ...emptyProfile({ name: 'Alex' }), glp1: true, goal: 'glp1' },
			household: false,
			useSample: false
		});
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Increase' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add).toHaveBeenCalledWith([expect.objectContaining({ servings: 2.25 })]);
	});
});

describe('LogSheet reading a plate from a photo', () => {
	/** What `/api/meals/photo` answers with: one food the catalog matched, one it did not. */
	function plateAnswers(items: unknown) {
		return vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ items }));
	}

	/** Hand the already-open picker a real picture, and wait for the still. */
	async function givePicture() {
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;
		const context = canvas.getContext('2d');
		if (context) {
			context.fillStyle = '#c98a3a';
			context.fillRect(0, 0, 64, 64);
		}
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('the canvas produced no blob');
		const input = document.querySelector('input[type="file"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('no file input was rendered');
		const data = new DataTransfer();
		data.items.add(new File([blob], 'plate.png', { type: 'image/png' }));
		input.files = data.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await expect.element(page.getByRole('button', { name: 'Read this plate' })).toBeInTheDocument();
	}

	/** Reach the still without a camera: the upload tab decodes a real picture. */
	async function chooseAPicture() {
		await openSheet();
		await page.getByRole('button', { name: 'Upload' }).click();
		await givePicture();
	}

	async function readThePlate(items: unknown) {
		await chooseAPicture();
		plateAnswers(items);
		await page.getByRole('button', { name: 'Read this plate' }).click();
	}

	it('turns what the photo held into proposals, and shows them on the type tab', async () => {
		await readThePlate([
			{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] },
			{ label: 'something green', grams: 40, food: null, alternatives: [] }
		]);
		await expect.element(page.getByText('HONEY NUT CHEERIOS').first()).toBeInTheDocument();
		await expect.element(page.getByText('something green').first()).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Type', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('reads the estimated weight through the same quantity pipeline as typing', async () => {
		// 74 g against a 37 g serving is two servings, and the row says so in grams.
		await readThePlate([{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] }]);
		await expect.element(page.getByText('2 servings · 74 g')).toBeInTheDocument();
	});

	it('leaves a food the catalog could not match for the person to match', async () => {
		await readThePlate([{ label: 'something green', grams: 40, food: null, alternatives: [] }]);
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
	});

	it('logs what the photo found under the photo source', async () => {
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await readThePlate([{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] }]);
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]?.[0]).toMatchObject({
			source: 'photo',
			name: 'HONEY NUT CHEERIOS',
			servings: 2
		});
	});

	it('drops the food it could not match, the way an unmatched typed item is dropped', async () => {
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await readThePlate([
			{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] },
			{ label: 'something green', grams: 40, food: null, alternatives: [] }
		]);
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]).toHaveLength(1);
	});

	it('adds to what was already parsed rather than replacing it', async () => {
		// Regression: reading a plate assigned over `proposals`, so anything already
		// typed on the Type tab disappeared without a word.
		resolvesTo(EGG);
		await openSheet();
		await page.getByLabelText('What you ate').fill('two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('Egg, large').first()).toBeInTheDocument();

		await page.getByRole('button', { name: 'Upload' }).click();
		await givePicture();
		plateAnswers([{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] }]);
		await page.getByRole('button', { name: 'Read this plate' }).click();

		await expect.element(page.getByText('HONEY NUT CHEERIOS').first()).toBeInTheDocument();
		await expect.element(page.getByText('Egg, large').first()).toBeInTheDocument();
	});

	it('says so rather than guessing when the catalog serving weighs nothing', async () => {
		// A serving of no weight gives the estimate nothing to divide by, so
		// `resolveQuantity` declines it and records one serving. The row has to say
		// that happened rather than present the one as a reading of the photo.
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		const weightless = { ...CEREAL, serving: { label: 'serving', grams: 0 } };
		await readThePlate([
			{ label: 'a bowl of cereal', grams: 74, food: weightless, alternatives: [] }
		]);
		await expect.element(page.getByText(/Couldn’t use “74 g”/)).toBeInTheDocument();

		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]?.[0]).toMatchObject({
			servings: 1,
			note: 'Portion unknown, set the servings'
		});
	});

	it('carries no such note when the estimate was read against a real serving', async () => {
		const add = vi.spyOn(tend, 'addLogItems').mockImplementation(() => undefined);
		await readThePlate([{ label: 'a bowl of cereal', grams: 74, food: CEREAL, alternatives: [] }]);
		await page.getByRole('button', { name: 'Add to today' }).click();
		expect(add.mock.calls[0]?.[0]?.[0]?.note).toBeUndefined();
	});

	it('stays on the photo tab when the photo held no food', async () => {
		await readThePlate([]);
		await expect
			.element(page.getByText(/Couldn’t recognise any food in that photo/))
			.toBeInTheDocument();
	});
});

/**
 * The sheet takes 95% of the phone screen (#162): the search results are no
 * longer capped to a short scrolling box of their own, and the "Add to
 * today" button sits in its own footer rather than scrolling away with a
 * long proposal list.
 */
describe('tall layout', () => {
	it('does not cap the search results to a short box of their own', async () => {
		await openSheet();
		await page.getByRole('button', { name: 'Search' }).click();
		const list = page.getByRole('list');
		await expect.element(list).toBeInTheDocument();
		await expect.element(list).not.toHaveClass(/max-h-/);
	});

	it('keeps the primary action reachable once the proposal list runs long', async () => {
		resolvesTo(...Array.from({ length: 30 }, () => null));
		await openSheet();
		const many = Array.from({ length: 30 }, (_, i) => `food number ${i}`).join(', ');
		await page.getByLabelText('What you ate').fill(many);
		await page.getByRole('button', { name: 'Parse' }).click();
		await expect.element(page.getByText('Proposed — tap to correct')).toBeInTheDocument();
		expect(page.getByRole('listitem').elements().length).toBeGreaterThanOrEqual(30);
		// Not conditionally hidden or dropped by a list this long: it is still
		// in the render output and still clickable.
		await expect.element(page.getByRole('button', { name: 'Add to today' })).toBeInTheDocument();
	});
});

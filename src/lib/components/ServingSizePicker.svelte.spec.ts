import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { catalogFoodToFood, type CatalogFoodPayload } from '$lib/domain/catalog-food';
import type { Food } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import ServingSizePicker from './ServingSizePicker.svelte';

/**
 * A catalog food, built the way `ServingAmount.svelte.spec.ts` builds one:
 * `catalogFoodToFood` is the only place that fills in `per100g`, which is
 * what `canRePortion` actually gates on.
 */
function catalogFood(payload: Partial<CatalogFoodPayload> & { id: number; name: string }): Food {
	return catalogFoodToFood({
		brand: null,
		kind: 'generic',
		category: 'Dairy and Egg Products',
		barcode: null,
		license: 'PDDL-1.0',
		serving: { label: '1 large', grams: 50 },
		per100g: {
			kcal: 143,
			protein: 12.6,
			fat: 9.5,
			carbs: 0.7,
			sugar: 0,
			fiber: 0,
			sodium: 0,
			saturatedFat: 0
		},
		...payload
	});
}

const NO_OPTIONS = catalogFood({ id: 201, name: 'Plain egg' });

const EMPTY_OPTIONS = catalogFood({
	id: 202,
	name: 'Rejected-portions egg',
	servingOptions: []
});

const EGG = catalogFood({
	id: 203,
	name: 'Egg, large',
	servingOptions: [
		{ label: '1 large', grams: 50 },
		{ label: '1 medium', grams: 44 }
	]
});

/**
 * Two rows sharing a label but not a weight -- the case `isCurrent` has to get
 * right by comparing both fields. A source that reports "1 cup" twice at two
 * different weights is real: `serving-options.ts` only dedupes rows whose
 * *label* collides case-insensitively, and two different sources can disagree
 * about how heavy their own "1 cup" is.
 */
const AMBIGUOUS_LABEL = catalogFood({
	id: 204,
	name: 'Shredded cheese',
	serving: { label: '1 cup', grams: 113 },
	servingOptions: [
		{ label: '1 cup', grams: 113 },
		{ label: '1 cup', grams: 100 }
	]
});

beforeEach(() => {
	// The store is a singleton, so a test that switches systems must not leave
	// the next one reading in it.
	tend.setUnits('metric');
});

describe('ServingSizePicker', () => {
	it('renders nothing for a food the catalog named no serving options for', async () => {
		await render(ServingSizePicker, { props: { food: NO_OPTIONS, onchoose: vi.fn() } });
		expect(page.getByRole('button').elements()).toHaveLength(0);
	});

	it('renders nothing for a food whose serving options were all rejected as implausible', async () => {
		// `servingOptions: []` is what `serving-options.ts` sends when every row
		// it saw failed `isPlausibleWeight` -- an empty list, not an absent key,
		// and the guard has to treat it the same as having none at all.
		await render(ServingSizePicker, { props: { food: EMPTY_OPTIONS, onchoose: vi.fn() } });
		expect(page.getByRole('button').elements()).toHaveLength(0);
	});

	it('offers a serving-size control, named for the food, when options exist', async () => {
		await render(ServingSizePicker, { props: { food: EGG, onchoose: vi.fn() } });
		await expect.element(page.getByLabelText(`Serving size for ${EGG.name}`)).toBeInTheDocument();
	});

	it('selects a portion by keyboard and hands the re-based food to onchoose', async () => {
		const onchoose = vi.fn<(food: Food) => void>();
		await render(ServingSizePicker, { props: { food: EGG, onchoose } });
		await page.getByLabelText(`Serving size for ${EGG.name}`).click();
		await page.getByRole('button', { name: '1 medium' }).click();
		expect(onchoose).toHaveBeenCalledTimes(1);
		const [rebased] = onchoose.mock.calls[0] ?? [];
		expect(rebased).toMatchObject({ servingLabel: '1 medium', grams: 44 });
	});

	it('marks only the option matching both label and grams as current', async () => {
		// Both rows read "1 cup"; only the 113 g one is the food's own serving.
		// A guard that compared the label alone would mark them both.
		await render(ServingSizePicker, { props: { food: AMBIGUOUS_LABEL, onchoose: vi.fn() } });
		await page.getByLabelText(`Serving size for ${AMBIGUOUS_LABEL.name}`).click();
		const rows = page.getByRole('button', { name: '1 cup' }).elements();
		expect(rows).toHaveLength(2);
		const pressed = rows.map((row) => row.getAttribute('aria-pressed'));
		expect(pressed.sort()).toEqual(['false', 'true']);
	});
});

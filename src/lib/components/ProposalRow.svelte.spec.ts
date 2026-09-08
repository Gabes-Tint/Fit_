import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { catalogFoodToFood } from '$lib/domain/catalog-food';
import type { QuantifiedItem } from '$lib/domain/quantity';
import type { Food } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import ProposalRow from './ProposalRow.svelte';

/**
 * A catalog row, the way the sheet hands one down. Since #146 there is no
 * device-side table behind a `foodId`, so a row only knows its food because the
 * sheet passes the one it resolved -- which is what `resolved` is for.
 */
function catalogRow(
	id: number,
	name: string,
	serving: { label: string; grams: number },
	per100g: { kcal: number; protein: number; fat: number; carbs: number },
	servingOptions?: readonly { label: string; grams: number }[]
) {
	return catalogFoodToFood({
		id,
		name,
		brand: null,
		kind: 'generic',
		category: 'Dairy and Egg Products',
		barcode: null,
		license: 'PDDL-1.0',
		serving,
		servingOptions,
		per100g: { ...per100g, sugar: 0, fiber: 0, sodium: 0, saturatedFat: 0 }
	});
}

/** A large egg: 50 g a serving. */
const egg = catalogRow(
	101,
	'Egg, large',
	{ label: '1 large', grams: 50 },
	{
		kcal: 143,
		protein: 12.6,
		fat: 9.5,
		carbs: 0.7
	}
);

/** A large egg with the catalog's own alternate portions -- what a picker needs to appear. */
const eggWithOptions = catalogRow(
	103,
	'Egg, large',
	{ label: '1 large', grams: 50 },
	{
		kcal: 143,
		protein: 12.6,
		fat: 9.5,
		carbs: 0.7
	},
	[
		{ label: '1 large', grams: 50 },
		{ label: '1 medium', grams: 44 },
		{ label: '100 g', grams: 100 }
	]
);

/** Olive oil, served by the tablespoon: 14 g, 119 kcal. */
const oil = catalogRow(
	102,
	'Olive oil',
	{ label: '1 tbsp', grams: 14 },
	{
		kcal: 884,
		protein: 0,
		fat: 100,
		carbs: 0
	}
);

const matched: QuantifiedItem = {
	foodId: egg.id,
	query: 'eggs',
	name: 'Egg, large',
	servings: 2,
	meal: 'breakfast',
	confidence: 0.92
};

const unmatched: QuantifiedItem = { ...matched, foodId: null, name: 'gruel', confidence: 0 };

/** A scanned food, arriving the same way every food does now. */
const scanned: QuantifiedItem = {
	...matched,
	foodId: 'catalog-4213',
	name: 'HONEY NUT CHEERIOS',
	servings: 1,
	confidence: 1
};

const cereal = catalogFoodToFood({
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
});

const handlers = {
	onmatch: vi.fn(),
	onpickmatch: vi.fn(),
	onchange: vi.fn(),
	onportion: vi.fn(),
	onremove: vi.fn()
};

beforeEach(() => {
	// The store is a singleton: a test that switches systems must not leave the
	// next one reading in it.
	tend.setUnits('metric');
});

describe('ProposalRow', () => {
	it('names the proposal', async () => {
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, ...handlers }
		});
		await expect.element(page.getByText('Egg, large')).toBeInTheDocument();
	});

	it('shows how confident the parse was', async () => {
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, ...handlers }
		});
		await expect.element(page.getByText(/92% sure/)).toBeInTheDocument();
	});

	it('shows the catalog serving label for a matched item', async () => {
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
		});
		await expect.element(page.getByText(egg.servingLabel)).toBeInTheDocument();
	});

	describe('the unit system the person set (#74)', () => {
		it('reads the portion and the recorded mass in metric by default', async () => {
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			await expect.element(page.getByText('1 large · 50 g')).toBeInTheDocument();
			await expect.element(page.getByText('2 servings · 100 g')).toBeInTheDocument();
		});

		it('reads both lines in ounces for someone reading in imperial', async () => {
			tend.setUnits('imperial');
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			await expect.element(page.getByText('1 large · 1.8 oz')).toBeInTheDocument();
			await expect.element(page.getByText('2 servings · 3.5 oz')).toBeInTheDocument();
			expect(document.body.textContent).not.toContain(' g');
		});
	});

	it('offers to match an item that has no catalog food', async () => {
		await render(ProposalRow, {
			props: { item: unmatched, step: 0.5, matching: false, ...handlers }
		});
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
	});

	it('falls back to a generic serving label when unmatched', async () => {
		await render(ProposalRow, {
			props: { item: unmatched, step: 0.5, matching: false, ...handlers }
		});
		// Exact: the row also states the recorded amount, which contains "servings".
		await expect.element(page.getByText('serving', { exact: true })).toBeInTheDocument();
	});

	it('asks to open the matcher', async () => {
		const onmatch = vi.fn();
		await render(ProposalRow, {
			props: { item: unmatched, step: 0.5, matching: false, ...handlers, onmatch }
		});
		await page.getByRole('button', { name: 'Match to catalog' }).click();
		expect(onmatch).toHaveBeenCalled();
	});

	it('shows the catalog search while matching', async () => {
		await render(ProposalRow, {
			props: { item: unmatched, step: 0.5, matching: true, ...handlers }
		});
		await expect.element(page.getByPlaceholder('Find a catalog match')).toBeInTheDocument();
	});

	it('reports a serving change', async () => {
		const onchange = vi.fn();
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, ...handlers, onchange }
		});
		await page.getByRole('button', { name: 'Increase' }).click();
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ servings: 2.5 }));
	});

	it('states what will be logged, in servings and in grams', async () => {
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
		});
		// A large egg is 50 g a serving.
		await expect.element(page.getByText('2 servings · 100 g')).toBeInTheDocument();
	});

	it('names the quantity it could not use, and what it recorded instead', async () => {
		const item: QuantifiedItem = {
			...matched,
			servings: 1,
			quantity: { amount: 2, unit: 'cups', kind: 'volume' }
		};
		await render(ProposalRow, {
			props: { item, step: 0.5, matching: false, resolved: egg, ...handlers }
		});
		await expect
			.element(page.getByText('Couldn’t use “2 cups” — recorded as 1 serving · 50 g'))
			.toBeInTheDocument();
	});

	it('says how many millilitres the food’s serving is, beside its weight', async () => {
		const item: QuantifiedItem = {
			...matched,
			servings: 2,
			quantity: { amount: 2, unit: 'tbsp', kind: 'volume' }
		};
		await render(ProposalRow, {
			props: { item, step: 0.5, matching: false, resolved: oil, ...handlers }
		});
		await expect.element(page.getByText('1 tbsp (15 ml)')).toBeInTheDocument();
		await expect.element(page.getByText('2 servings · 28 g')).toBeInTheDocument();
	});

	it('says nothing about a unit it did use', async () => {
		const item: QuantifiedItem = {
			...matched,
			quantity: { amount: 100, unit: 'g', kind: 'mass' }
		};
		await render(ProposalRow, {
			props: { item, step: 0.5, matching: false, resolved: egg, ...handlers }
		});
		await expect.element(page.getByText('2 servings · 100 g')).toBeInTheDocument();
	});

	it('reports a removal', async () => {
		const onremove = vi.fn();
		await render(ProposalRow, {
			props: { item: matched, step: 0.5, matching: false, ...handlers, onremove }
		});
		await page.getByRole('button', { name: /Remove/ }).click();
		expect(onremove).toHaveBeenCalled();
	});

	describe('the quantity, in the food’s own serving (#158)', () => {
		it('offers the amount in servings, not in grams', async () => {
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			await expect.element(page.getByLabelText('Amount in servings')).toHaveValue('2');
		});

		it('reports a typed eighth, which the stepper alone could not reach', async () => {
			const onchange = vi.fn();
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers, onchange }
			});
			await page.getByLabelText('Amount in servings').fill('1/8');
			expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ servings: 0.125 }));
		});

		it('states the energy and macros of what is about to be logged', async () => {
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			// Two large eggs: the egg's own per-serving numbers, doubled.
			await expect.element(page.getByText(/^144 kcal · 12.6g protein/)).toBeInTheDocument();
		});

		it('offers grams to a row whose food weighs something, and nothing to one that does not', async () => {
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			await expect.element(page.getByLabelText('Enter the amount in grams')).toBeInTheDocument();
		});

		it('leaves an unmatched row in servings, with no weight to convert against', async () => {
			await render(ProposalRow, {
				props: { item: unmatched, step: 0.5, matching: false, ...handlers }
			});
			expect(page.getByLabelText('Enter the amount in grams').elements()).toHaveLength(0);
			await expect.element(page.getByLabelText('Amount in servings')).toHaveValue('2');
		});
	});

	it('shows the serving of the resolved food', async () => {
		await render(ProposalRow, {
			props: { item: scanned, step: 0.5, matching: false, resolved: cereal, ...handlers }
		});
		await expect.element(page.getByText('3/4 cup')).toBeInTheDocument();
	});

	it('does not ask for a catalog match for a food that was already resolved', async () => {
		await render(ProposalRow, {
			props: { item: scanned, step: 0.5, matching: false, resolved: cereal, ...handlers }
		});
		expect(document.body.textContent).not.toContain('Match to catalog');
	});

	it('still asks for a match when no food was resolved', async () => {
		await render(ProposalRow, {
			props: { item: scanned, step: 0.5, matching: false, ...handlers }
		});
		await expect
			.element(page.getByRole('button', { name: 'Match to catalog' }))
			.toBeInTheDocument();
	});

	describe('choosing a serving size (#74 follow-up)', () => {
		it('offers no serving-size control for a food with no catalog options', async () => {
			await render(ProposalRow, {
				props: { item: matched, step: 0.5, matching: false, resolved: egg, ...handlers }
			});
			expect(page.getByLabelText(`Serving size for ${egg.name}`).elements()).toHaveLength(0);
		});

		it('offers no serving-size control for an unmatched row', async () => {
			await render(ProposalRow, {
				props: { item: unmatched, step: 0.5, matching: false, ...handlers }
			});
			expect(page.getByRole('button', { name: /Serving size for/ }).elements()).toHaveLength(0);
		});

		it('names the food in the serving-size control, distinct from nutrition facts', async () => {
			await render(ProposalRow, {
				props: {
					item: matched,
					step: 0.5,
					matching: false,
					resolved: eggWithOptions,
					...handlers
				}
			});
			await expect
				.element(page.getByLabelText(`Serving size for ${eggWithOptions.name}`))
				.toBeInTheDocument();
		});

		it('picks a portion by keyboard and rebases the food without touching servings', async () => {
			const onportion = vi.fn<(food: Food) => void>();
			await render(ProposalRow, {
				props: {
					item: matched,
					step: 0.5,
					matching: false,
					resolved: eggWithOptions,
					...handlers,
					onportion
				}
			});
			await page.getByLabelText(`Serving size for ${eggWithOptions.name}`).click();
			await page.getByRole('button', { name: '1 medium' }).click();
			expect(onportion).toHaveBeenCalledTimes(1);
			const [rebased] = onportion.mock.calls[0] ?? [];
			if (!rebased) throw new Error('onportion was not called with a food');
			expect(rebased.servingLabel).toBe('1 medium');
			expect(rebased.grams).toBe(44);
			// The person's own count of 2 servings is untouched by the re-base --
			// only the food each of those servings means has changed.
			expect(handlers.onchange).not.toHaveBeenCalled();
		});

		it('marks the food’s current portion as the one already selected', async () => {
			await render(ProposalRow, {
				props: {
					item: matched,
					step: 0.5,
					matching: false,
					resolved: eggWithOptions,
					...handlers
				}
			});
			await page.getByLabelText(`Serving size for ${eggWithOptions.name}`).click();
			await expect
				.element(page.getByRole('button', { name: '1 large' }))
				.toHaveAttribute('aria-pressed', 'true');
			await expect
				.element(page.getByRole('button', { name: '1 medium' }))
				.toHaveAttribute('aria-pressed', 'false');
		});
	});
});

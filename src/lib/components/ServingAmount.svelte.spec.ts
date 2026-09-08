import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { catalogFoodToFood, type CatalogFoodPayload } from '$lib/domain/catalog-food';
import type { Food } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import ServingAmountHarness from './ServingAmountHarness.svelte';

function catalogFood(payload: Partial<CatalogFoodPayload> & { id: number; name: string }): Food {
	return catalogFoodToFood({
		brand: null,
		kind: 'branded',
		category: 'Fast Food',
		barcode: null,
		license: 'PDDL-1.0',
		serving: { label: '100 g', grams: 100 },
		per100g: {
			kcal: 100,
			protein: 1,
			fat: 1,
			carbs: 1,
			sugar: 0,
			fiber: 0,
			sodium: 0,
			saturatedFat: 0
		},
		...payload
	});
}

/** A Big Mac: one sandwich, 219 g, and no packaging measure behind it. */
const BIG_MAC = catalogFood({
	id: 9001,
	name: 'Big Mac',
	serving: { label: '1 sandwich', grams: 219 },
	per100g: {
		kcal: 257,
		protein: 12.8,
		fat: 14.6,
		carbs: 18.7,
		sugar: 4.1,
		fiber: 1.5,
		sodium: 430,
		saturatedFat: 5
	}
});

/** A bag of chips: a 28 g label serving, with the source naming the 155 g bag too. */
const CHIPS = catalogFood({
	id: 9002,
	name: 'Nacho Cheese Tortilla Chips',
	serving: { label: '1 oz', grams: 28 },
	servingOptions: [
		{ label: '1 oz', grams: 28 },
		{ label: '1 bag', grams: 155 }
	],
	per100g: {
		kcal: 500,
		protein: 7,
		fat: 26,
		carbs: 61,
		sugar: 3,
		fiber: 4,
		sodium: 590,
		saturatedFat: 3.5
	}
});

/**
 * A food the catalog could only measure by volume: a cup with no weight behind
 * it and no portion row, so nothing knows what one serving weighs.
 */
const UNWEIGHED: Food = { ...BIG_MAC, id: 'catalog-9003', servingLabel: '1 cup', grams: 0 };

const amount = () => page.getByTestId('amount');
const field = () => page.getByLabelText('Amount in servings');
const gramsField = () => page.getByLabelText('Amount in grams');
const toGrams = () => page.getByLabelText('Enter the amount in grams');
const toServings = () => page.getByLabelText('Enter the amount in servings');

beforeEach(() => {
	// The store is a singleton, so a test that switches systems must not leave
	// the next one reading in it.
	tend.setUnits('metric');
});

describe('ServingAmount', () => {
	it('starts on the food’s own serving, said in servings rather than in grams', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
		await expect.element(field()).toHaveValue('1');
		await expect.element(page.getByText('serving', { exact: true })).toBeInTheDocument();
	});

	it('moves by half a serving on one tap of +', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
		await page.getByRole('button', { name: 'Increase' }).click();
		await expect.element(amount()).toHaveTextContent('1.5');
	});

	it('moves by a quarter for someone eating in quarters', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.25 } });
		await page.getByRole('button', { name: 'Increase' }).click();
		await expect.element(amount()).toHaveTextContent('1.25');
	});

	it('logs two sandwiches, and their 438 g, after two taps of +', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
		const increase = page.getByRole('button', { name: 'Increase' });
		await increase.click();
		await increase.click();
		await expect.element(amount()).toHaveTextContent('2');
		await toGrams().click();
		await expect.element(gramsField()).toHaveValue('438');
	});

	it('steps back down and stops at an eighth rather than at nothing', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 0.5, step: 0.5 } });
		await page.getByRole('button', { name: 'Decrease' }).click();
		await expect.element(amount()).toHaveTextContent('0.125');
	});

	it('takes an eighth typed as a fraction, and carries it through a half step', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
		await field().fill('1/8');
		await expect.element(amount()).toHaveTextContent('0.125');
		await page.getByRole('button', { name: 'Increase' }).click();
		await expect.element(amount()).toHaveTextContent('0.625');
	});

	it('leaves the amount alone while the field is empty mid-edit', async () => {
		await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 2, step: 0.5 } });
		await field().fill('');
		await expect.element(amount()).toHaveTextContent('2');
	});

	describe('grams, one tap away', () => {
		it('reads the amount as a weight, and takes one typed back as servings', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
			await toGrams().click();
			await expect.element(gramsField()).toHaveValue('219');
			await gramsField().fill('438');
			await expect.element(amount()).toHaveTextContent('2');
		});

		it('gives back the same half serving that went in', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1.5, step: 0.5 } });
			// 1.5 servings is 328.5 g, which reads as 329 — the amount underneath
			// must not become 329 / 219.
			await toGrams().click();
			await expect.element(gramsField()).toHaveValue('329');
			await toServings().click();
			await expect.element(field()).toHaveValue('1.5');
			await expect.element(amount()).toHaveTextContent('1.5');
		});

		it('gives back the same eighth that went in', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 0.125, step: 0.5 } });
			await toGrams().click();
			await toServings().click();
			await expect.element(amount()).toHaveTextContent('0.125');
		});

		it('is read and typed in ounces for someone reading in imperial (#74)', async () => {
			tend.setUnits('imperial');
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
			await page.getByLabelText('Enter the amount in ounces').click();
			const ounces = page.getByLabelText('Amount in ounces');
			await expect.element(ounces).toHaveValue('7.7');
			// Two ounces of a 219 g serving is a fraction of one, not two of them.
			await ounces.fill('2');
			await expect.element(amount()).toHaveTextContent('0.259');
		});

		it('is not offered for a food nothing knows the weight of', async () => {
			await render(ServingAmountHarness, { props: { food: UNWEIGHED, servings: 1, step: 0.5 } });
			expect(toGrams().elements()).toHaveLength(0);
			// The amount is still editable: only the weight is unknown.
			await page.getByRole('button', { name: 'Increase' }).click();
			await expect.element(amount()).toHaveTextContent('1.5');
		});

		it('is not offered for an item with no catalog food behind it yet', async () => {
			await render(ServingAmountHarness, { props: { servings: 1, step: 0.5 } });
			expect(toGrams().elements()).toHaveLength(0);
			await page.getByRole('button', { name: 'Increase' }).click();
			await expect.element(amount()).toHaveTextContent('1.5');
		});
	});

	describe('a packaged food', () => {
		it('starts on the label serving the source gave, not on 100 g', async () => {
			await render(ServingAmountHarness, { props: { food: CHIPS, servings: 1, step: 0.5 } });
			await toGrams().click();
			await expect.element(gramsField()).toHaveValue('28');
		});

		it('offers the whole pack when the source knows what the package weighs', async () => {
			await render(ServingAmountHarness, { props: { food: CHIPS, servings: 1, step: 0.5 } });
			await page.getByRole('button', { name: 'Whole pack · 155 g' }).click();
			await toGrams().click();
			await expect.element(gramsField()).toHaveValue('155');
		});

		it('offers the label serving back after the whole pack was chosen', async () => {
			await render(ServingAmountHarness, { props: { food: CHIPS, servings: 1, step: 0.5 } });
			await page.getByRole('button', { name: 'Whole pack · 155 g' }).click();
			await page.getByRole('button', { name: '1 oz' }).click();
			await expect.element(amount()).toHaveTextContent('1');
		});

		it('reads the package weight in the system the person set (#74)', async () => {
			tend.setUnits('imperial');
			await render(ServingAmountHarness, { props: { food: CHIPS, servings: 1, step: 0.5 } });
			await expect
				.element(page.getByRole('button', { name: 'Whole pack · 5.5 oz' }))
				.toBeInTheDocument();
		});

		it('offers no pack for a food whose source named none', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
			expect(page.getByRole('button', { name: /Whole pack/ }).elements()).toHaveLength(0);
		});
	});

	describe('the energy line', () => {
		it('states what one serving comes to', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
			await expect
				.element(page.getByText('563 kcal · 28g protein · 41g carbs · 32g fat'))
				.toBeInTheDocument();
		});

		it('follows the amount as it changes', async () => {
			await render(ServingAmountHarness, { props: { food: BIG_MAC, servings: 1, step: 0.5 } });
			await page.getByRole('button', { name: 'Increase' }).click();
			await expect.element(page.getByText(/^845 kcal/)).toBeInTheDocument();
		});

		it('says nothing for an item with no catalog food behind it yet', async () => {
			await render(ServingAmountHarness, { props: { servings: 1, step: 0.5 } });
			expect(document.body.textContent).not.toContain('kcal');
		});
	});
});

import { describe, expect, it } from 'vitest';
import { catalogFoodToFood, type CatalogFoodPayload } from './catalog-food';
import { scaleFood } from './foods';
import { logFromCatalogFood } from './log-entry';
import { resolveQuantity } from './quantity';
import { amountFromGrams, amountGrams, describeEnergy } from './serving-amount';
import {
	BASIS_GRAMS,
	canRePortion,
	foodAtPortion,
	nutrientsAtGrams,
	type PortionedFood
} from './serving-choice';
import { describePortion, servingMassGrams } from './serving-display';
import type { Food, NutrientBasis } from './types';
import { ZERO_MICROS } from './types';

/**
 * A branded cereal whose default serving is 37 g. The numbers are chosen so
 * that re-basing and multiplying are visibly different arithmetic: three 37 g
 * servings come to 417 kcal, while 111 g converted in one step comes to 416.
 */
const CEREAL_PAYLOAD: CatalogFoodPayload = {
	id: 4213,
	name: 'HONEY NUT CHEERIOS',
	brand: 'GENERAL MILLS',
	kind: 'branded',
	category: 'Breakfast Cereals',
	barcode: '00016000275287',
	license: 'PDDL-1.0',
	serving: { label: '3/4 cup', grams: 37 },
	servingOptions: [
		{ label: '3/4 cup', grams: 37 },
		{ label: '1 cup', grams: 28 },
		{ label: '100 g', grams: 100 }
	],
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

const CEREAL = catalogFoodToFood(CEREAL_PAYLOAD) as PortionedFood;

/** The portion the food already came scaled onto: the compatibility case. */
const DEFAULT_PORTION = { label: CEREAL.servingLabel, grams: CEREAL.grams };

/** A different portion off the same food's list. */
const CUP = { label: '1 cup', grams: 28 };

/** A bundled food: no `per100g`, no basis, nothing to re-portion from. */
const SEEDED: Food = {
	id: 'egg-large',
	name: 'Egg, large',
	aliases: [],
	category: 'protein',
	provenance: 'usda',
	servingLabel: '1 egg',
	grams: 50,
	kcal: 72,
	protein: 6.3,
	carbs: 0.4,
	fat: 4.8,
	micros: { ...ZERO_MICROS }
};

const CONTEXT = { servings: 1, meal: 'breakfast', date: '2026-09-08', source: 'barcode' } as const;

describe('nutrientsAtGrams', () => {
	it('leaves the basis alone at the basis weight itself', () => {
		expect(nutrientsAtGrams(CEREAL_PAYLOAD.per100g, BASIS_GRAMS)).toMatchObject({
			kcal: 375,
			protein: 8.1,
			carbs: 78.4,
			fat: 4.5
		});
	});

	it.each([
		{ grams: 37, kcal: 139, protein: 3, carbs: 29, fat: 1.7 },
		{ grams: 28, kcal: 105, protein: 2.3, carbs: 22, fat: 1.3 },
		{ grams: 111, kcal: 416, protein: 9, carbs: 87, fat: 5 },
		{ grams: 172, kcal: 645, protein: 13.9, carbs: 134.8, fat: 7.7 },
		// Under a tenth of a gram of anything but carbohydrate, so only the
		// carbohydrate survives rounding: the case that shows a weight is
		// converted rather than rounded away wholesale.
		{ grams: 0.1, kcal: 0, protein: 0, carbs: 0.1, fat: 0 }
	])('converts $grams g of the basis to $kcal kcal', ({ grams, kcal, protein, carbs, fat }) => {
		expect(nutrientsAtGrams(CEREAL_PAYLOAD.per100g, grams)).toMatchObject({
			kcal,
			protein,
			carbs,
			fat
		});
	});

	it('reads a nutrient the source never reported as zero rather than as absent', () => {
		const sparse: NutrientBasis = {
			kcal: 200,
			protein: null,
			fat: null,
			carbs: null,
			saturatedFat: null,
			fiber: null,
			sugar: null,
			sodium: null
		};
		expect(nutrientsAtGrams(sparse, 50)).toMatchObject({ kcal: 100, protein: 0, fat: 0 });
		expect(nutrientsAtGrams(sparse, 50).micros.potassium).toBe(0);
	});

	it('carries every micro the basis states, scaled with the rest', () => {
		expect(nutrientsAtGrams(CEREAL_PAYLOAD.per100g, 37).micros).toMatchObject({
			fiber: 3,
			sugar: 9,
			sodium: 185
		});
	});
});

describe('canRePortion', () => {
	it('says a catalog food can be re-portioned, because it kept its basis', () => {
		expect(canRePortion(CEREAL)).toBe(true);
	});

	it('says a bundled food cannot, because it never had a basis to convert from', () => {
		expect(canRePortion(SEEDED)).toBe(false);
	});
});

describe('foodAtPortion', () => {
	it('takes the chosen portion’s label and weight, so the two always describe one portion', () => {
		const chosen = foodAtPortion(CEREAL, CUP);
		expect({ servingLabel: chosen.servingLabel, grams: chosen.grams }).toEqual({
			servingLabel: '1 cup',
			grams: 28
		});
	});

	it('recomputes the nutrients from the basis rather than rescaling the baked serving', () => {
		expect(foodAtPortion(CEREAL, CUP)).toMatchObject({
			kcal: 105,
			protein: 2.3,
			carbs: 22,
			fat: 1.3
		});
	});

	it('keeps the basis and the choices, so a portion can be picked again afterwards', () => {
		const chosen = foodAtPortion(CEREAL, CUP);
		expect(chosen.per100g).toEqual(CEREAL_PAYLOAD.per100g);
		expect(chosen.servingOptions).toEqual(CEREAL_PAYLOAD.servingOptions);
	});

	it.each([
		{ what: 'zero', grams: 0 },
		{ what: 'a negative weight', grams: -28 },
		{ what: 'no number at all', grams: Number.NaN },
		{ what: 'an unbounded weight', grams: Number.POSITIVE_INFINITY }
	])('declines a portion naming $what, rather than logging nutrients of NaN', ({ grams }) => {
		expect(foodAtPortion(CEREAL, { label: 'broken', grams })).toEqual(CEREAL);
	});

	it('acts on the smallest weight above zero, so the refusal is a boundary and not a range', () => {
		expect(foodAtPortion(CEREAL, { label: 'a crumb', grams: 0.1 })).toMatchObject({
			grams: 0.1,
			carbs: 0.1
		});
	});
});

/**
 * The claim this slice has to earn: opening a portion picker on the serving
 * the food already came with changes nothing anybody can see. It holds because
 * `catalogFoodToFood` and `foodAtPortion` now run the same conversion at the
 * same weight, so the check is deep equality rather than a spot-check of kcal.
 */
describe('the food’s own default portion', () => {
	it('re-bases to the identical food, micros and all', () => {
		expect(foodAtPortion(CEREAL, DEFAULT_PORTION)).toEqual(CEREAL);
	});

	it.each([0, 1, 2, 2.5, 3])('logs %s servings identically through scaleFood', (servings) => {
		expect(scaleFood(foodAtPortion(CEREAL, DEFAULT_PORTION), servings)).toEqual(
			scaleFood(CEREAL, servings)
		);
	});

	it('leaves the log entry a catalog food already produced untouched', () => {
		const rebased = logFromCatalogFood(foodAtPortion(CEREAL, DEFAULT_PORTION), CONTEXT);
		const direct = logFromCatalogFood(CEREAL, CONTEXT);
		expect({ ...rebased, id: '' }).toEqual({ ...direct, id: '' });
	});
});

/**
 * #251 gave `LogItem` a `grams` holding the mass of one serving, and #252
 * routes every serving-weight question through `servingMassGrams`. A re-based
 * food is an ordinary `Food`, so both must follow the chosen portion without
 * being told about it — that is the whole reason `foodAtPortion` returns a
 * `Food` rather than a portion-aware wrapper.
 */
describe('a re-based food and the readers that already exist', () => {
	it('answers servingMassGrams with the chosen weight, not the one the catalog named', () => {
		expect(servingMassGrams(foodAtPortion(CEREAL, CUP))).toBe(28);
		expect(servingMassGrams(CEREAL)).toBe(37);
	});

	it('carries the chosen weight onto the log entry, through scaleFood’s existing grams', () => {
		const item = logFromCatalogFood(foodAtPortion(CEREAL, CUP), { ...CONTEXT, servings: 2 });
		// The mass of one serving, not of the two logged: #251's contract.
		expect(item).toMatchObject({ servingLabel: '1 cup', grams: 28, kcal: 210, foodId: null });
	});

	it('describes the logged portion off the entry’s own weight', () => {
		const item = logFromCatalogFood(foodAtPortion(CEREAL, CUP), { ...CONTEXT, servings: 2 });
		// 56 g rather than the 74 g two of the catalog's own servings weigh: the
		// mass #74 appends is the one the chosen portion put on the entry.
		expect(describePortion(item, item.servings, 'metric')).toBe('2 × 1 cup (240 ml) · 56 g');
	});

	it('measures #252’s amount field against the chosen serving', () => {
		const chosen = foodAtPortion(CEREAL, CUP);
		expect(amountGrams(chosen, 2)).toBe(56);
		expect(amountFromGrams(chosen, 56)).toBe(2);
		// The same 56 g is a smaller count of the food's own larger serving.
		expect(amountFromGrams(CEREAL, 56)).toBe(1.514);
	});

	it('reproduces today’s energy line exactly when the default portion is chosen', () => {
		expect(describeEnergy(foodAtPortion(CEREAL, DEFAULT_PORTION), 1.5)).toBe(
			describeEnergy(CEREAL, 1.5)
		);
	});

	it('divides a typed mass by the chosen portion, not by the one the catalog named first', () => {
		const spec = { amount: 140, unit: 'g', kind: 'mass' } as const;
		expect(resolveQuantity(spec, foodAtPortion(CEREAL, CUP)).servings).toBe(5);
		expect(resolveQuantity(spec, CEREAL).servings).toBe(3.78);
	});
});

/**
 * Re-basing and counting servings are different arithmetic and are allowed to
 * disagree by a rounding step; what is not allowed is disagreeing about the
 * default. Pinned so that a later picker cannot quietly be built on the
 * assumption that 111 g and three 37 g servings are the same number.
 */
describe('re-basing against counting servings', () => {
	it('rounds three servings of a portion and one serving of their combined mass apart', () => {
		expect(scaleFood(CEREAL, 3)).toMatchObject({ kcal: 417, fat: 5.1 });
		expect(nutrientsAtGrams(CEREAL_PAYLOAD.per100g, 111)).toMatchObject({ kcal: 416, fat: 5 });
	});
});

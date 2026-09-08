import { describe, expect, it } from 'vitest';
import { catalogFoodToFood, type CatalogFoodPayload } from './catalog-food';
import { scaleFood } from './foods';
import { logFromPortionedFood } from './log-entry';
import { resolveQuantity } from './quantity';
import {
	BASIS_GRAMS,
	canRePortion,
	foodAtPortion,
	nutrientsAtGrams,
	nutritionAtPortion,
	type PortionedFood
} from './serving-choice';
import { loadStateDocument, SCHEMA_VERSION } from './state-document';
import type { Food, LogItem, NutrientBasis } from './types';
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

	it('leaves a food untouched when the portion chosen is the one it already came on', () => {
		expect(foodAtPortion(CEREAL, DEFAULT_PORTION)).toEqual(CEREAL);
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

describe('nutritionAtPortion', () => {
	it.each([0, 1, 2, 2.5, 3])(
		'reproduces what %s servings already show when the default portion is chosen',
		(servings) => {
			expect(nutritionAtPortion(CEREAL, DEFAULT_PORTION, servings)).toEqual(
				scaleFood(CEREAL, servings)
			);
		}
	);

	it('rounds a portion switch the way a servings change rounds, not the way one long sum would', () => {
		// Three 37 g servings: 3 × 139 kcal. Converting 111 g from the basis in
		// one step gives 416, and would make the same plate of food read
		// differently depending on which control the person touched last.
		expect(nutritionAtPortion(CEREAL, DEFAULT_PORTION, 3)).toMatchObject({ kcal: 417, fat: 5.1 });
		expect(nutrientsAtGrams(CEREAL_PAYLOAD.per100g, 111)).toMatchObject({ kcal: 416, fat: 5 });
	});

	it.each([
		{ servings: 1.5, kcal: 158, protein: 3.5, carbs: 33 },
		{ servings: 2.5, kcal: 263, protein: 5.8, carbs: 55 }
	])('scales a chosen portion by $servings servings', ({ servings, kcal, protein, carbs }) => {
		expect(nutritionAtPortion(CEREAL, CUP, servings)).toMatchObject({ kcal, protein, carbs });
	});

	it('names the chosen portion on the result, so a day list can read it back', () => {
		expect(nutritionAtPortion(CEREAL, CUP, 2).servingLabel).toBe('1 cup');
	});

	it('records nothing for no servings at all', () => {
		expect(nutritionAtPortion(CEREAL, CUP, 0)).toMatchObject({ kcal: 0, protein: 0 });
	});
});

describe('a chosen portion and a typed quantity', () => {
	it('divides a typed mass by the chosen portion, not by the one the catalog named first', () => {
		const spec = { amount: 140, unit: 'g', kind: 'mass' } as const;
		expect(resolveQuantity(spec, foodAtPortion(CEREAL, CUP)).servings).toBe(5);
		expect(resolveQuantity(spec, CEREAL).servings).toBe(3.78);
	});
});

describe('logFromPortionedFood', () => {
	it('records the chosen portion’s label, weight and recomputed macros', () => {
		expect(logFromPortionedFood(CEREAL, CUP, { ...CONTEXT, servings: 2 })).toMatchObject({
			servingLabel: '1 cup',
			grams: 28,
			kcal: 210,
			servings: 2,
			foodId: null
		});
	});

	it('records the food’s own serving when the portion named no usable weight', () => {
		const item = logFromPortionedFood(CEREAL, { label: 'broken', grams: 0 }, CONTEXT);
		expect(item).toMatchObject({ servingLabel: '3/4 cup', grams: 37, kcal: 139 });
	});

	it('logs the same numbers as the ordinary path when the default portion is chosen', () => {
		const chosen = logFromPortionedFood(CEREAL, DEFAULT_PORTION, CONTEXT);
		expect(chosen).toMatchObject({ kcal: CEREAL.kcal, protein: CEREAL.protein });
	});
});

/**
 * A stored document at the current schema version, as a build without the
 * entry weight wrote it. Built as a literal rather than through `emptyState`
 * so that the entry is exactly what an older build would have put there.
 */
function documentWithEntry(item: Record<string, unknown>): unknown {
	return {
		schemaVersion: SCHEMA_VERSION,
		onboarded: true,
		activeProfileId: 'p-1',
		profiles: [{ id: 'p-1', log: [item] }],
		weekPlan: [],
		pantry: [],
		routines: [],
		trainingPlan: [],
		workouts: [],
		activeWorkout: null,
		loadUnit: 'kg',
		restSeconds: 90,
		units: 'metric'
	};
}

const ENTRY_WITHOUT_WEIGHT = {
	id: 'l-1',
	foodId: null,
	date: '2026-09-01',
	meal: 'lunch',
	servings: 1,
	source: 'barcode',
	name: 'HONEY NUT CHEERIOS',
	kcal: 139,
	protein: 3,
	carbs: 29,
	fat: 1.7,
	micros: { ...ZERO_MICROS },
	servingLabel: '3/4 cup'
};

function loggedEntries(document: unknown): LogItem[] {
	const result = loadStateDocument(document);
	if (!result.ok) throw new Error(`document refused: ${result.reason}`);
	return result.state.profiles[0]?.log ?? [];
}

describe('an entry weight in a stored document', () => {
	it('loads a document written before entries kept a weight, without migrating it', () => {
		const result = loadStateDocument(documentWithEntry(ENTRY_WITHOUT_WEIGHT));
		expect(result).toMatchObject({ ok: true, migrated: false });
	});

	it('leaves an older entry with no weight at all, rather than inventing one', () => {
		const [item] = loggedEntries(documentWithEntry(ENTRY_WITHOUT_WEIGHT));
		expect(item?.grams).toBeUndefined();
		expect(Object.hasOwn(item ?? {}, 'grams')).toBe(false);
	});

	it('carries a weight back out of a document that has one', () => {
		const [item] = loggedEntries(documentWithEntry({ ...ENTRY_WITHOUT_WEIGHT, grams: 28 }));
		expect(item?.grams).toBe(28);
	});
});

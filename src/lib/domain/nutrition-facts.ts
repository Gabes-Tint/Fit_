import type { Food, LogItem, Micros, NutrientBasis } from './types';
import { round1 } from './utils';

/**
 * One line of the nutrition facts sheet (#175): a nutrient scaled onto a
 * serving, or `null` when the catalog never said — never a false zero.
 */
export type NutritionFactRow = {
	key: string;
	label: string;
	value: number | null;
	unit: string;
};

/** The basis every row scales from: per 100 g/mL, exactly as the catalog stores it. */
const PER = 100;

/**
 * `[key, label, unit]` for every row, energy and macros first, then micros —
 * the sheet's order. Units are the standard FDC nutrient dictionary's for
 * these nutrient ids (`data/scripts/etl_usda.py` passes the source `amount`
 * straight through with no conversion, per nutrient ids
 * 1092/1089/1087/1090/1095/1106/1162/1114/1178 — potassium, iron, calcium,
 * magnesium and zinc in mg; vitamin A, D and B12 in mcg; vitamin C in mg).
 * This is inferred from the FDC dictionary, not stated in the repo's own
 * schema docs, and is called out as an assumption in #175's PR.
 */
const FIELDS: [key: keyof NutrientBasis, label: string, unit: string][] = [
	['kcal', 'Calories', 'kcal'],
	['protein', 'Protein', 'g'],
	['carbs', 'Carbohydrates', 'g'],
	['fat', 'Fat', 'g'],
	['saturatedFat', 'Saturated fat', 'g'],
	['fiber', 'Fiber', 'g'],
	['sugar', 'Sugar', 'g'],
	['sodium', 'Sodium', 'mg'],
	['potassium', 'Potassium', 'mg'],
	['iron', 'Iron', 'mg'],
	['calcium', 'Calcium', 'mg'],
	['magnesium', 'Magnesium', 'mg'],
	['zinc', 'Zinc', 'mg'],
	['vitaminA', 'Vitamin A', 'mcg'],
	['vitaminC', 'Vitamin C', 'mg'],
	['vitaminD', 'Vitamin D', 'mcg'],
	['vitaminB12', 'Vitamin B12', 'mcg']
];

/**
 * The nutrition facts for one serving: `basis`'s per-100 g/mL numbers scaled
 * by `grams`, in a stable order. A `null` in the basis stays `null` — it is
 * never coerced to zero, because "the catalog does not know" and "the food
 * has none" are different facts and only one of them is true.
 */
export function nutritionFactsRows(basis: NutrientBasis, grams: number): NutritionFactRow[] {
	const factor = grams / PER;
	return FIELDS.map(([key, label, unit]) => {
		const raw = basis[key];
		const value = raw === null || raw === undefined ? null : round1(raw * factor);
		return { key, label, value, unit };
	});
}

/**
 * A basis built from a food or log item's own already-scaled numbers, used
 * when there is no raw per-100 g snapshot to scale from (a bundled food, or
 * a logged entry — neither carries one). Passed to `nutritionFactsRows` with
 * `grams` 100 so the scaling factor is 1 and the numbers come back unchanged.
 * Every field this basis can supply is a real, final number, so nothing here
 * is `null` — a bundled food's data is hand-curated and complete, and a
 * logged item is snapshotted from a `Food` that was already zeroed for any
 * micro the catalog never reported (see `catalogFoodToFood`).
 */
function identityBasis(source: {
	kcal: number;
	protein: number;
	carbs: number;
	fat: number;
	micros: Micros;
}): NutrientBasis {
	return {
		kcal: source.kcal,
		protein: source.protein,
		carbs: source.carbs,
		fat: source.fat,
		saturatedFat: null,
		...source.micros
	};
}

/**
 * The nutrition facts for a `Food` as it stands in a search result or a
 * proposal: the catalog's own per-100 g basis when there is one (so a gap
 * reads as `null`), or the food's own numbers unchanged when there is not.
 */
export function nutritionFactsForFood(food: Food): NutritionFactRow[] {
	if (food.per100g) return nutritionFactsRows(food.per100g, food.grams);
	return nutritionFactsRows(identityBasis(food), PER);
}

/**
 * The nutrition facts for a logged entry. `LogItem` never kept the catalog's
 * raw per-100 g snapshot — only the already-scaled totals for what was
 * logged — so this always reads as the identity basis.
 */
export function nutritionFactsForLogItem(item: LogItem): NutritionFactRow[] {
	return nutritionFactsRows(identityBasis(item), PER);
}

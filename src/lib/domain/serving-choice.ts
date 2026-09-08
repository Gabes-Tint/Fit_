/**
 * Re-basing a food onto a serving the person picked, rather than the one the
 * catalog happened to name first.
 *
 * MyFitnessPal's Add Food screen has two controls: a servings count, and a
 * tappable serving size — "4.0 oz", "1.0 medium breast", "100 g". Ours had
 * only the count. `catalogFoodToFood` converts the catalog's per-100 g
 * nutrients onto one serving at fetch time and bakes the result into
 * `Food.kcal` and friends; `scaleFood` then multiplies those baked numbers by
 * a plain scalar. Nothing in that path can change *which* serving is being
 * multiplied, because by the time anyone could choose, the choice has already
 * been spent.
 *
 * So a chosen portion is not a second multiplier. It is the same conversion
 * done again from the food's own `per100g` basis at a different weight — and
 * once that is done, the food that comes out is an ordinary `Food` again, with
 * the chosen label and the chosen weight on it. Everything downstream —
 * `scaleFood`, `logFromCatalogFood`, `resolveQuantity`, `describePortion` —
 * keeps working unchanged, because none of them is told anything new. That is
 * the whole design: re-base the food, then carry on.
 *
 * **The seed-food trap.** `SeedFood` — the sample journal, the recipe book —
 * carries no `per100g` and no `grams`. There is no basis to re-convert from,
 * and inventing one would mean asserting a 100 g basis nobody measured. A
 * seeded food therefore has no alternative portions to offer, and the question
 * never arises. That is enforced in the types rather than by convention:
 * `foodAtPortion` demands a `PortionedFood`, which a `SeedFood` cannot satisfy
 * — it has neither the basis nor the `grams` a `Food` requires — so the
 * mistake is a compile error, not a runtime guard someone can forget.
 */

import type { ServingRow } from './default-serving';
import { scaleFood } from './foods';
import type { Food, NutrientBasis } from './types';
import { ZERO_MICROS } from './types';
import { round1 } from './utils';

/**
 * The basis every nutrient in the catalog is stored on. Exported because
 * `catalog-food.ts` needs the same number for its own "the catalog named no
 * serving weight" fallback, and two copies of it could drift into disagreeing
 * about what the nutrients even mean.
 */
export const BASIS_GRAMS = 100;

/**
 * A food that can be re-portioned: one that kept the per-100 g basis its
 * nutrients were converted from. Every catalog food has one; nothing bundled
 * does.
 */
export type PortionedFood = Food & { per100g: NutrientBasis };

/** A weight a conversion can be trusted to: finite and above zero. */
function isWeight(grams: number): boolean {
	return Number.isFinite(grams) && grams > 0;
}

/**
 * Whether a food kept the basis a portion choice needs. The way a caller
 * holding a plain `Food` — one that may have come from anywhere — reaches
 * `foodAtPortion` at all.
 */
export function canRePortion(food: Food): food is PortionedFood {
	return food.per100g !== undefined;
}

/**
 * The nutrients of `grams` of a food, from its per-100 g basis.
 *
 * This is the arithmetic `catalogFoodToFood` has always done to put a catalog
 * row onto its default serving, lifted out so that the default serving and a
 * chosen one are converted by the same code rather than by two copies that
 * could round differently. A nutrient the source never reported reads as zero
 * here — `Food` has no room for "unknown", which is why the raw basis is kept
 * alongside for the nutrition facts sheet to read the gaps off.
 */
export function nutrientsAtGrams(
	per100g: NutrientBasis,
	grams: number
): Pick<Food, 'kcal' | 'protein' | 'carbs' | 'fat' | 'micros'> {
	const factor = grams / BASIS_GRAMS;
	const scaled = (value: number | null | undefined) => round1((value ?? 0) * factor);
	return {
		kcal: Math.round(per100g.kcal * factor),
		protein: scaled(per100g.protein),
		carbs: scaled(per100g.carbs),
		fat: scaled(per100g.fat),
		micros: {
			...ZERO_MICROS,
			fiber: scaled(per100g.fiber),
			sugar: scaled(per100g.sugar),
			sodium: scaled(per100g.sodium),
			potassium: scaled(per100g.potassium),
			iron: scaled(per100g.iron),
			calcium: scaled(per100g.calcium),
			magnesium: scaled(per100g.magnesium),
			zinc: scaled(per100g.zinc),
			vitaminA: scaled(per100g.vitaminA),
			vitaminC: scaled(per100g.vitaminC),
			vitaminD: scaled(per100g.vitaminD),
			vitaminB12: scaled(per100g.vitaminB12)
		}
	};
}

/**
 * The same food, converted onto a chosen serving: its label, its weight, and
 * its nutrients recomputed from the basis at that weight.
 *
 * The label and the weight travel together and are never set apart. A portion
 * is identified by its label — someone who tapped "1.0 medium breast" wants to
 * read that back, not "172 g" — while the weight is what the calories were
 * scaled from and what `describePortion` appends in the reader's own system
 * (#74). Carrying one without the other would give the person a label from one
 * portion and a mass from another.
 *
 * A portion naming no usable weight leaves the food exactly as it was. The
 * alternative is nutrients of `NaN` or `Infinity` landing in a log entry, where
 * they would poison the day's totals long after the bad row was forgotten;
 * declining to act on a choice that says nothing is the smaller failure, and
 * matches how `resolveQuantity` refuses a serving weight it cannot divide by.
 */
export function foodAtPortion(food: PortionedFood, portion: ServingRow): Food {
	if (!isWeight(portion.grams)) return food;
	return {
		...food,
		servingLabel: portion.label,
		grams: portion.grams,
		...nutrientsAtGrams(food.per100g, portion.grams)
	};
}

/**
 * What `servings` of a chosen portion come to.
 *
 * Deliberately re-basing and *then* calling `scaleFood`, rather than folding
 * both into one multiplication of the basis. The two are not the same number:
 * `scaleFood` multiplies nutrients that have already been rounded onto one
 * serving, so three servings of a 37 g portion of a 375 kcal/100 g cereal is
 * 3 × 139 = 417 kcal, where converting 111 g in one step gives 416. Neither is
 * more correct, but only one of them agrees with what the app already shows —
 * and picking a food's own default portion has to reproduce today's numbers
 * exactly, or switching portions and switching servings would quietly disagree
 * about the same plate of food.
 */
export function nutritionAtPortion(food: PortionedFood, portion: ServingRow, servings: number) {
	return scaleFood(foodAtPortion(food, portion), servings);
}

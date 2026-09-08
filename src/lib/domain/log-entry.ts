import type { ServingRow } from './default-serving';
import { SEED_FOOD_BY_ID, scaleFood } from './foods';
import { foodAtPortion, type PortionedFood } from './serving-choice';
import type { Food, LogItem, LogSource, Meal, SeedFood } from './types';
import { uid } from './utils';

export type LogFromFood = {
	foodId: string;
	servings: number;
	meal: Meal;
	date: string;
	source: LogSource;
	note?: string | undefined;
};

/** Everything a log entry needs beyond the food itself. */
export type LogEntryContext = Omit<LogFromFood, 'foodId'>;

function entry(food: SeedFood, foodId: string | null, context: LogEntryContext): LogItem {
	const { servings, meal, date, source, note } = context;
	return {
		id: uid('l-'),
		date,
		meal,
		source,
		note,
		servings,
		...scaleFood(food, servings),
		foodId
	};
}

/**
 * Build a log entry from a seeded food via `scaleFood`.
 *
 * The sample journal and a recipe logged off the plan are what reach this, and
 * both name an id out of `seed-foods.ts`. Those ids are hand-written and stable,
 * which is why such an entry keeps its `foodId` and can still be re-portioned
 * exactly later. An unknown id throws rather than logging a zero-calorie line.
 */
export function logFromFood({ foodId, ...context }: LogFromFood): LogItem {
	const food = SEED_FOOD_BY_ID[foodId];
	if (!food) throw new Error(`Unknown food: ${foodId}`);
	return entry(food, foodId, context);
}

/**
 * Build a log entry from a food that came from the server catalog, which since
 * #146 is every food a person can find, scan or type.
 *
 * `foodId` is null on purpose. The catalog's own id is a hint the ETL does not
 * promise to keep -- it rebuilds the file wholesale -- so an entry stored
 * against it would point at a different food, or at nothing, after the next
 * rebuild. The entry carries its own name, serving label and macros, which is
 * what makes it stay right without one, and is already how an imported row is
 * logged.
 */
export function logFromCatalogFood(food: Food, context: LogEntryContext): LogItem {
	return entry(food, null, context);
}

/**
 * Build a log entry from a food logged against a serving the person picked,
 * rather than the one the catalog happened to name first.
 *
 * The choice is spent before the entry is built: `foodAtPortion` returns an
 * ordinary `Food` carrying the chosen label, the chosen weight and nutrients
 * recomputed at it, so this goes through `logFromCatalogFood` like every other
 * catalog entry and inherits the null `foodId` for the same reason.
 *
 * The one thing it adds is the weight. `LogItem` has never kept one, and
 * `servingMassGrams` (#74) has had to read whatever mass the label states
 * instead — which works for "100 g" and fails for "1.0 medium breast". Reading
 * it off the re-based food rather than off `portion` is deliberate: a portion
 * naming no usable weight is one `foodAtPortion` declined to act on, and the
 * entry has to record the serving it was actually built from, not the one that
 * was asked for and refused.
 */
export function logFromPortionedFood(
	food: PortionedFood,
	portion: ServingRow,
	context: LogEntryContext
): LogItem {
	const chosen = foodAtPortion(food, portion);
	return { ...logFromCatalogFood(chosen, context), grams: chosen.grams };
}

import { SEED_FOOD_BY_ID, scaleFood } from './foods';
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

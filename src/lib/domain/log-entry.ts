import { SEED_FOOD_BY_ID, scaleFood } from './foods';
import type { Food, LogItem, LogSource, Meal, SeedFood } from './types';
import { round1, uid } from './utils';

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
 * Rescale a stored entry's macros to a new serving count.
 *
 * This was `tend.svelte.ts`'s private `rescale()`, used when a person edits an
 * already-logged entry's servings. It moved here because relogItem() below
 * needs the exact same math for a different reason -- re-logging a past entry
 * at today's serving count -- and a second, slightly different copy of a ratio
 * calculation is how "12.6g protein" and "12.7g protein" end up disagreeing for
 * no reason anyone can find later. `tend.svelte.ts` now calls this instead of
 * keeping its own copy.
 *
 * A seeded food (one with a `foodId`) re-derives through `scaleFood`, so it
 * stays exact even if `seed-foods.ts` changes later. Anything without one --
 * a catalog food, since `logFromCatalogFood` never stores a `foodId`, or a
 * hand-typed custom entry -- has no formula behind it, so it scales its own
 * stored numbers by the servings ratio instead.
 *
 * An entry stored at 0 servings (a custom entry where someone typed absolute
 * macros for, say, "this can of soup") has no ratio to scale by: 0 servings
 * could stand for any amount per serving. Treated as a ratio of 1 -- the
 * macros stay put and only `servings` moves -- rather than dividing by zero or
 * manufacturing an Infinity that would then get rounded into something
 * meaningless.
 */
export function rescaleLogItem(item: LogItem, servings: number): LogItem {
	const source = item.foodId ? SEED_FOOD_BY_ID[item.foodId] : undefined;
	if (!source) {
		const ratio = item.servings === 0 ? 1 : servings / item.servings;
		return {
			...item,
			servings,
			kcal: Math.round(item.kcal * ratio),
			protein: round1(item.protein * ratio),
			carbs: round1(item.carbs * ratio),
			fat: round1(item.fat * ratio),
			micros: Object.fromEntries(
				Object.entries(item.micros).map(([k, v]) => [k, round1(v * ratio)])
			) as LogItem['micros']
		};
	}
	return { ...item, servings, ...scaleFood(source, servings) };
}

/** What a past entry needs supplied to become a fresh one for today. */
export type RelogContext = {
	date: string;
	meal: Meal;
	servings: number;
};

/**
 * Turn a past `LogItem` into a fresh one, logged again today.
 *
 * This is the one-tap re-log from the Recent/Frequent list (#recent-foods):
 * `recent-foods.ts` picks which food and defaults `servings` to whatever was
 * last used, but the entry itself still needs its own identity -- a new `id`,
 * so deleting today's copy can never touch the original it was re-logged from
 * -- and its macros rescaled to the chosen servings via the same ratio math
 * `updateLog` already uses when an edit changes an entry's servings after the
 * fact (`rescaleLogItem`, above).
 *
 * `source` is always `'manual'`. A re-log is not typed, scanned, spoken or
 * photographed; it is a person tapping a row of something they already
 * logged before, which is closest to choosing a food by hand. Adding a
 * dedicated `LogSource` for it was considered and rejected: nothing in the
 * codebase branches exhaustively over `LogSource` today (grepped for
 * `Record<LogSource` and switches over `.source` -- there are none), so a new
 * member would buy no safety and would cost `ProvenanceBadge` and every other
 * reader one more case to know about for a distinction the log itself doesn't
 * otherwise track. Where the macros originally came from is still visible on
 * `item.provenance`, which a re-log carries forward unchanged.
 *
 * The note is dropped rather than carried forward: a note on the original
 * entry ("half a bowl", "ran out of milk") describes that occasion, not this
 * one, and re-attaching it silently would misrepresent today's entry as
 * having been annotated by the person logging it just now.
 */
export function relogItem(item: LogItem, context: RelogContext): LogItem {
	const { date, meal, servings } = context;
	return {
		...rescaleLogItem(item, servings),
		id: uid('l-'),
		date,
		meal,
		source: 'manual',
		note: undefined
	};
}

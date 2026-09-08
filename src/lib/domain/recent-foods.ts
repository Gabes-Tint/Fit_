import type { LogItem } from './types';
import { addDaysISO, todayISO } from './utils';

/**
 * How far back "recent" reaches.
 *
 * MyFitnessPal doesn't publish its own window, so this is a judgment call: 60
 * days is roughly two months, long enough that a food eaten every other week
 * (a Sunday roast, one of three recipes cooked in rotation) still counts as a
 * habit, short enough that a bulk phase or a diet abandoned in the spring has
 * dropped off the list by summer rather than cluttering it forever.
 */
export const RECENT_WINDOW_DAYS = 60;

/**
 * How many foods the list surfaces.
 *
 * A list nobody scrolls is not a feature: a phone screen shows roughly 6-8
 * rows before scrolling starts, so 12 gives two screens' worth of real choice
 * -- enough to cover breakfast, lunch and a couple of regulars -- without the
 * "recent" list turning into a second, slower search box.
 */
export const MAX_RECENT_FOODS = 12;

/** One distinct food, ready to render as a re-loggable row. */
export type RecentFood = {
	/** The grouping key this food was found under -- see `groupKey` below. */
	key: string;
	name: string;
	brand: string | undefined;
	servingLabel: string;
	/** kcal for one serving, derived from the most recently logged entry. */
	kcalPerServing: number;
	/** The servings this food was last logged at -- re-logging defaults to this. */
	lastServings: number;
	lastDate: string;
	/** How many qualifying entries this food has, within the window. */
	count: number;
};

/**
 * Group entries that name the same food.
 *
 * `logFromCatalogFood` (see `log-entry.ts`) sets `foodId: null` on every
 * catalog food on purpose: the catalog's own id is a hint the ETL does not
 * promise to keep, since it rebuilds the file wholesale, and a stored id that
 * later points at a different food -- or at nothing -- is worse than storing
 * none. That means most of a real journal cannot be grouped by `foodId` at
 * all, so the key here is the entry's own name and brand, normalised by
 * trimming and case-folding, and `foodId` is used only where it exists and is
 * stable: seeded foods and recipes logged off the plan. This is the crux of
 * the whole module -- get the key wrong and "recent" either fractures one
 * food across ten rows ("Egg" vs "egg " vs "EGG") or merges two unrelated
 * ones into one.
 */
function groupKey(item: LogItem): string {
	if (item.foodId) return `id:${item.foodId}`;
	const name = item.name.trim().toLowerCase();
	const brand = (item.brand ?? '').trim().toLowerCase();
	return `name:${name}|${brand}`;
}

type Group = {
	key: string;
	latest: LogItem;
	count: number;
};

/**
 * Fold the log into one group per food, keeping only entries within the
 * window and tracking each group's most recently logged entry and how many
 * qualifying entries it has.
 *
 * "Most recent" is decided by `date`, not by position in `log`: imported
 * history can land in the array out of chronological order, and trusting
 * array order would let an old import silently win over something logged
 * yesterday. A same-day tie falls back to `id`, which `uid()` derives from
 * `Date.now()` and is therefore itself chronological to the millisecond --
 * good enough to break a tie no calendar date can.
 */
function groupsWithinWindow(log: readonly LogItem[], today: string): Group[] {
	const cutoff = addDaysISO(today, -RECENT_WINDOW_DAYS);
	const groups = new Map<string, Group>();
	for (const item of log) {
		// A date outside [cutoff, today] is either too old to be "recent" or, for
		// a clock-skewed device, dated in the future and not yet something to
		// suggest re-logging.
		if (item.date < cutoff || item.date > today) continue;
		const key = groupKey(item);
		const existing = groups.get(key);
		if (!existing) {
			groups.set(key, { key, latest: item, count: 1 });
			continue;
		}
		existing.count += 1;
		const isNewer =
			item.date > existing.latest.date ||
			(item.date === existing.latest.date && item.id > existing.latest.id);
		if (isNewer) existing.latest = item;
	}
	return [...groups.values()];
}

function toRecentFood(group: Group): RecentFood {
	const { latest } = group;
	// A custom entry logged at 0 servings (someone typed absolute macros for
	// "this can of soup") has no per-serving figure to divide out -- 0 servings
	// could stand for any amount per serving. Showing the stored total instead
	// of dividing by zero keeps the row honest about the only number the entry
	// actually has, matching the same guard `rescaleLogItem` (log-entry.ts)
	// applies when a stored entry has no ratio to scale by.
	const kcalPerServing =
		latest.servings > 0 ? Math.round(latest.kcal / latest.servings) : latest.kcal;
	return {
		key: group.key,
		name: latest.name,
		brand: latest.brand,
		servingLabel: latest.servingLabel,
		kcalPerServing,
		lastServings: latest.servings,
		lastDate: latest.date,
		count: group.count
	};
}

/**
 * Two groups tied on whatever the caller is ordering by (same date, or same
 * count and date) must not swap between calls just because a `Map`'s
 * iteration order happens to differ. `key` is stable and unique per food, so
 * comparing it lexically is a final tiebreak that always produces the same
 * order for the same input.
 */
function byKey(a: Group, b: Group): number {
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Distinct foods logged in the last `RECENT_WINDOW_DAYS`, most recently
 * logged first -- "what did I eat lately" -- capped at `MAX_RECENT_FOODS`.
 */
export function mostRecentFoods(log: readonly LogItem[], today: string = todayISO()): RecentFood[] {
	const groups = groupsWithinWindow(log, today);
	groups.sort((a, b) => {
		if (a.latest.date !== b.latest.date) return a.latest.date < b.latest.date ? 1 : -1;
		return byKey(a, b);
	});
	return groups.slice(0, MAX_RECENT_FOODS).map(toRecentFood);
}

/**
 * Distinct foods logged in the last `RECENT_WINDOW_DAYS`, most frequently
 * logged first -- "what do I usually eat" -- ties broken by recency and then
 * by `byKey`, capped at `MAX_RECENT_FOODS`.
 */
export function mostFrequentFoods(
	log: readonly LogItem[],
	today: string = todayISO()
): RecentFood[] {
	const groups = groupsWithinWindow(log, today);
	groups.sort((a, b) => {
		if (a.count !== b.count) return b.count - a.count;
		if (a.latest.date !== b.latest.date) return a.latest.date < b.latest.date ? 1 : -1;
		return byKey(a, b);
	});
	return groups.slice(0, MAX_RECENT_FOODS).map(toRecentFood);
}

/**
 * When two things are the same food (#259).
 *
 * The History list asks it of two log entries; the log sheet's remembered
 * portion asks it of an entry and the catalog row somebody just tapped. It is
 * one question, and it was answered twice — once here in `recent-foods.ts`,
 * once in `usual-portion.ts` — until the two answers were folded into this
 * module, which is named for the question rather than for either caller.
 *
 * **Not the food's id.** `logFromCatalogFood` (log-entry.ts) stores
 * `foodId: null` for every catalog food on purpose: the ETL rebuilds the
 * catalog wholesale, so an id is a hint it does not promise to keep, and an
 * entry holding an id that later points at a different food — or at nothing —
 * is worse than one holding none. Most of a real journal therefore has no id
 * to match on at all, which is what #159 discovered the hard way: keying on
 * the id would have shipped code no logged food could ever reach.
 *
 * **So the name and the brand.** They are what an entry keeps, and
 * `scaleFood` copies both off the catalog food at log time, so the two sides
 * are the same strings. Both are folded — trimmed and lower-cased — before
 * they are compared, because an imported journal is not held to that: the
 * same porridge arriving as `" Oatmeal "` and as `oatmeal` is one food, and
 * showing it as two rows, each with its own remembered portion, is the bug
 * folding exists to prevent.
 *
 * **An id, where there is one.** Seeded foods and recipes logged off the plan
 * do keep an id, and theirs is stable, so those entries are matched on it and
 * are deliberately a different food from a catalog row that happens to share
 * their name. That is the same verdict both callers reached separately, and
 * it is why a remembered portion never crosses from the seeded egg to the
 * catalog's.
 */

/**
 * The fields identity is read from. A catalog `Food` has an `id`, not a
 * `foodId`, so passing one names it by name and brand — which is right: that
 * is what it will log as.
 */
export type IdentifiedFood = {
	readonly foodId?: string | null;
	readonly name: string;
	readonly brand?: string | undefined;
};

/** Trim and case-fold, so how a name was typed is not part of what it names. */
function fold(text: string | undefined): string {
	return (text ?? '').trim().toLowerCase();
}

/**
 * A string that is equal for two foods exactly when they are the same food.
 *
 * A key rather than a bare predicate because the History list groups a whole
 * journal at once and wants a `Map` key, and because a key that two callers
 * share cannot drift the way two predicates can.
 */
export function foodIdentity(food: IdentifiedFood): string {
	if (food.foodId) return `id:${food.foodId}`;
	return `name:${fold(food.name)}|${fold(food.brand)}`;
}

/** Whether these two name the same food. */
export function isSameFood(a: IdentifiedFood, b: IdentifiedFood): boolean {
	return foodIdentity(a) === foodIdentity(b);
}

/**
 * The portion this person usually logs of a food, and how to read it back (#159).
 *
 * **The log is the memory.** Nothing new is stored: `Profile.log` already holds
 * every entry with its name, its brand and its servings, so "what did I last
 * have of this?" is a question the document can already answer. That is why
 * this slice adds no field, no `FIELD_CHECKS` entry and no migration rung —
 * there is no shape change to migrate. It is also why the memory cannot grow
 * without bound or drift out of step with what was eaten: there is no second
 * copy to prune and none to keep true. Deleting a log entry forgets it, which
 * is what someone deleting a log entry means.
 *
 * **Servings, not grams.** Servings are the canonical amount everything here
 * stores (`serving-amount.ts`), so replaying one is lossless and needs no
 * conversion. The alternative — remembering the mass eaten and dividing it by
 * whatever the serving weighs today — was rejected because it breaks the
 * commonest case: someone who logs one label serving must get one label serving
 * back, and re-deriving it from 219 g would hand them 0.97 of a serving the
 * first time the catalog restates the sandwich. A serving redefinition
 * therefore moves the mass a remembered amount comes to, and the card shows
 * that mass before anything is logged, so it is visible rather than silent.
 */

import { EIGHTH, roundAmount } from './serving-amount';
import type { Food, LogItem } from './types';

/**
 * What identifies a food in somebody's log. Not its id: the catalog's own id
 * never reaches an entry, so this is all there is to match on.
 */
export type RememberedFood = Pick<Food, 'name' | 'brand'>;

/**
 * Whether this entry is one of that food's.
 *
 * Two halves, and both are needed. `foodId === null` is what a catalog food
 * logs as, on purpose: the ETL rebuilds the catalog wholesale and its ids are
 * not promised to survive (`logFromCatalogFood`), so an entry that kept an id
 * came from the seeded table instead and is a different, precisely identified
 * food — which is how the History list treats it too. What is left is the name
 * and the brand, and they are compared exactly, because both sides are the same
 * catalog string: `scaleFood` copies them onto the entry at log time. Folding
 * case or padding the way `recent-foods.ts` does would be guessing that two
 * differently written names are one food, which is a guess this has no need to
 * make.
 */
function sameFood(item: LogItem, food: RememberedFood): boolean {
	return item.foodId === null && item.name === food.name && item.brand === food.brand;
}

/**
 * The amount last logged of this food, or `null` for one never logged.
 *
 * No window, unlike the History list. That list ranks foods a person is
 * browsing, so forgetting one they abandoned in the spring keeps it useful;
 * this is one food they have just named themselves, and the last amount is
 * still the best guess however long ago it was.
 */
export function usualServings(
	log: readonly LogItem[],
	food: RememberedFood | undefined
): number | null {
	if (food === undefined) return null;
	let latest: LogItem | null = null;
	for (const item of log) {
		if (!sameFood(item, food)) continue;
		// The whole log, not its tail: an import can land older entries after
		// newer ones. `>=` because a calendar day cannot separate two entries
		// logged within it, and the log is appended to, so the later of two on
		// one day is the one further along.
		if (latest === null || item.date >= latest.date) latest = item;
	}
	return latest === null ? null : latest.servings;
}

/**
 * Whether an amount reads as a count of servings rather than as a weight.
 *
 * The amount control works in eighths (`EIGHTH`), so every amount reachable by
 * tapping the stepper, by taking the label serving, or by typing a count sits
 * on that grid. An amount off it — 1.607 servings, which is 45 g of a 28 g
 * serving — is the arithmetic behind a weight somebody typed, and showing it
 * back as "1.607 servings" would be showing a number they never chose. This is
 * what decides which of the two fields a remembered amount opens in, and it
 * asks the amount rather than storing the unit beside it: the unit is a way of
 * entering a number, not a property of what was eaten.
 */
export function readsAsServings(servings: number): boolean {
	return Math.round(servings / EIGHTH) * EIGHTH === roundAmount(servings);
}

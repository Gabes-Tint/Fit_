/**
 * The portion this person usually logs of a food, and how to read it back (#159).
 *
 * **The log is the memory.** Nothing new is stored: `Profile.log` already holds
 * every entry with its `foodId` and its `servings`, so "what did I last have of
 * this?" is a question the document can already answer. That is why this slice
 * adds no field, no `FIELD_CHECKS` entry and no migration rung — there is no
 * shape change to migrate. It is also why the memory cannot grow without
 * bound or drift out of step with the log: there is no second copy to prune and
 * none to keep in step. Deleting a log entry forgets it, which is what someone
 * who deletes a log entry means.
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
import type { LogItem } from './types';

/**
 * The amount last logged of this food, or `null` for one never logged.
 *
 * The whole log is read rather than the tail, because nothing promises the
 * array is in date order — a synced document is two devices' entries merged.
 * `>=` rather than `>` so that among several entries on the same day the last
 * one added wins, which is what "last logged" means on a field whose
 * granularity is the day.
 */
export function usualServings(log: readonly LogItem[], foodId: string | null): number | null {
	if (foodId === null) return null;
	let latest: LogItem | null = null;
	for (const item of log) {
		if (item.foodId !== foodId) continue;
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
 * back to them as "1.607 servings" would be showing them a number they never
 * chose. This is what decides which of the two fields a remembered amount
 * opens in, and it asks the amount rather than storing the unit alongside it:
 * the unit is a way of entering a number, not a property of what was eaten.
 */
export function readsAsServings(servings: number): boolean {
	return Math.round(servings / EIGHTH) * EIGHTH === roundAmount(servings);
}

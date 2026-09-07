/**
 * Whether a catalog serving row names a genuine, single countable item — a
 * Big Mac, a cookie, a slice of bread — rather than milk's cup, a bare
 * "100 g", or a branded label's count-per-serving (#178).
 *
 * `food_serving` mixes three shapes under one column: a household measure
 * like "1.0 item 7.6 oz", the guaranteed "100 g" catch-all every food carries
 * (`default-serving.ts`'s `PLAIN_GRAMS`), and — the trap this module exists
 * to reject — a branded label like "13 PIECE" whose grams are the weight of
 * thirteen pieces together, not of one. Reading that as "one piece weighs
 * 100 g" would be wrong by a factor of thirteen.
 *
 * Only a leading count of exactly one survives: `SINGLE_COUNT_NOUN` anchors
 * at the start of the label and requires "1" or "1.0…" immediately before the
 * noun, which is what makes "13 PIECE" and "4 PIECE" fail to match at all —
 * they never reach a grams check because they never name a single item in
 * the first place. That same anchoring is why a bare weight ("100 g", "1
 * cup", "250 ml", "1 ONZ") is rejected too: none of `g`, `cup`, `ml` or `onz`
 * is in the countable-noun list, so the label reads as naming nothing this
 * feature can show as "N of them".
 */

// Re-exported: `default-serving.ts` and this module both describe the same
// `food_serving` row, and the server side (`server/catalog/unit-measure.ts`)
// reaches for it here rather than importing two domain modules for one type.
export type { ServingRow } from './default-serving';
import type { ServingRow } from './default-serving';

/** The nouns a label must name to read as a single countable item. */
const COUNTABLE_NOUNS = [
	'item',
	'piece',
	'sandwich',
	'cookie',
	'slice',
	'bar',
	'each',
	'burger',
	'can',
	'bottle',
	'container'
] as const;

export type CountableNoun = (typeof COUNTABLE_NOUNS)[number];

/**
 * A leading count of exactly one, then a countable noun: "1 item", "1.0
 * item 7.6 oz", "1  sandwich" (a label with more than one space before the
 * unit, the way the ETL sometimes writes it). Anchored at the start, the same
 * way `default-serving.ts`'s `WHOLE_ITEM` is: a noun named only later in the
 * label ("a can of 1 sandwich per box") must not count.
 */
const SINGLE_COUNT_NOUN = new RegExp(`^1(?:\\.0+)?\\s+(${COUNTABLE_NOUNS.join('|')})\\b`, 'i');

/** A weight a stepper or a display can be trusted to: finite and above zero. */
function hasWeight(grams: number): boolean {
	return Number.isFinite(grams) && grams > 0;
}

/**
 * The countable noun a label names, or `null` when it names none — either
 * because the count is not exactly one ("13 PIECE"), or because what follows
 * the count is not on the countable list ("1 cup", "100 g", "1 ONZ").
 */
export function unitNoun(label: string): CountableNoun | null {
	const match = SINGLE_COUNT_NOUN.exec(label.trim());
	if (match === null) return null;
	return String(match[1]).toLowerCase() as CountableNoun;
}

/**
 * Whether a row is a usable unit measure: a real weight, behind a label that
 * names exactly one countable item.
 */
export function isUnitMeasure(row: ServingRow): boolean {
	return hasWeight(row.grams) && unitNoun(row.label) !== null;
}

/**
 * The first usable unit measure among a food's household-measure rows, or
 * `null` when none of them names a single countable item.
 *
 * `rows` is taken in the order the caller already decided between competing
 * candidates, matching `pickDefaultServing`'s contract: this only chooses the
 * first row that passes, never re-orders what it was given.
 */
export function pickUnitMeasure(rows: readonly ServingRow[]): ServingRow | null {
	return rows.find(isUnitMeasure) ?? null;
}

/**
 * A fixed table rather than a pluralization rule: the countable nouns are a
 * short, closed list (`COUNTABLE_NOUNS`), so spelling out every plural is
 * both simpler and more mutation-honest than a regex whose "ends in ch/sh/s/
 * x/z" branches no noun on the list ever actually exercises both sides of.
 */
const PLURAL_NOUN: Record<CountableNoun, string> = {
	item: 'items',
	piece: 'pieces',
	sandwich: 'sandwiches',
	cookie: 'cookies',
	slice: 'slices',
	bar: 'bars',
	each: 'each',
	burger: 'burgers',
	can: 'cans',
	bottle: 'bottles',
	container: 'containers'
};

function pluralNoun(noun: CountableNoun): string {
	return PLURAL_NOUN[noun];
}

/**
 * A count with no more than two decimal places, and no trailing zero.
 *
 * `toFixed(2)` never produces more than one trailing zero for a value this
 * already failed `Number.isInteger` on — two would mean the value was a whole
 * number after all — so a single `replace`, not a `+` quantifier, is all
 * stripping it needs; and a value with a genuine trailing zero always keeps a
 * non-zero digit before it, so the result never ends in a bare ".".
 */
function formatCount(count: number): string {
	const rounded = Math.round(count * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}

/**
 * "2 pieces", "1 sandwich" — a count of a food's unit, read off the same
 * label a serving is shown against. `null` when the label names no usable
 * unit, so a caller can use this to decide whether the toggle it backs has
 * anything to switch to.
 */
export function formatUnitCount(count: number, label: string): string | null {
	const noun = unitNoun(label);
	if (noun === null) return null;
	const word = Math.round(count * 100) / 100 === 1 ? noun : pluralNoun(noun);
	return `${formatCount(count)} ${word}`;
}

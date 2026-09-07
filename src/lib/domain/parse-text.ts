import { classifyUnit, type QuantitySpec } from './quantity';
import { tokenize } from './text-tokens';
import { UNIT_SPELLING_WORDS } from './unit-spellings';
import type { Meal } from './types';

/**
 * What a typed sentence says, as far as the device can tell on its own.
 *
 * Splitting "two eggs, 150g rice" into chunks and reading the quantity off each
 * one is arithmetic on the words, so it happens here. Naming the food is not:
 * that needs the catalog, and the catalog is 2.5 million rows on the server
 * (`POST /api/foods/resolve`). This module hands out the leftover text as a
 * `query` and takes no view on what food it names.
 */

const NUMBER_WORDS: Record<string, number> = {
	a: 1,
	an: 1,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	half: 0.5,
	dozen: 12
};

/**
 * Words that sit between a quantity and the food. Dropped before the query is
 * sent — leaving the filler in drags a real match down the ranking.
 * Every accepted unit spelling comes from `unit-spellings.ts`, the same table
 * `classifyUnit` reads, so a unit word is filler here exactly when it is a
 * unit there.
 */
const UNIT_HINTS = [
	'a',
	'an',
	'of',
	'large',
	'medium',
	'small',
	'slice',
	'slices',
	'scoop',
	'scoops',
	'can',
	'cans',
	'bar',
	'bowl',
	'piece',
	'pieces',
	...UNIT_SPELLING_WORDS
];

/**
 * Units that can be written against the number with no space: "150g rice".
 * `slice` predates the measurement units and stays for "2slices toast"; the
 * rest come from `unit-spellings.ts`, so the glued spelling and the spaced one
 * read the same vocabulary.
 */
const GLUED_UNITS = [...UNIT_SPELLING_WORDS, 'slices', 'slice'];
/** A literal character escaped for use inside a regex alternation — "tbsp." names a dot, not "any character". */
function escapeForRegex(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Built from a fixed list of identifiers, so no input reaches the pattern.
const GLUED_UNIT_RE = new RegExp(
	`^(\\d+\\.?\\d*)(${GLUED_UNITS.map(escapeForRegex).join('|')})\\s+(.*)$`,
	'i'
);

/**
 * A capture the pattern guarantees. `String` states that without a fallback that
 * could never run — and turns a wrong index into visible text rather than into
 * an empty string indistinguishable from a real one.
 */
function group(m: RegExpMatchArray, index: number): string {
	return String(m[index]);
}

/**
 * Leading-quantity patterns, tried in order. Each yields the quantity and the
 * remaining text: "1/2 avocado", "150g rice", "two eggs". `unitIndex` names the
 * group holding a unit glued to the number, where a pattern reads one.
 */
const QUANTITY_PATTERNS: {
	re: RegExp;
	qty: (m: RegExpMatchArray) => number | undefined;
	restIndex: number;
	unitIndex?: number;
}[] = [
	{ re: /^(\d+)\s*\/\s*(\d+)\s+(.*)$/, qty: (m) => Number(m[1]) / Number(m[2]), restIndex: 3 },
	{ re: /^(\d+\.?\d*)\s*(x|×)?\s+(.*)$/, qty: (m) => Number(m[1]), restIndex: 3 },
	{ re: GLUED_UNIT_RE, qty: (m) => Number(m[1]), restIndex: 3, unitIndex: 2 }
];

/**
 * "two eggs": a quantity written as a word. Matched against the table rather
 * than read out of the phrase, so there is no capture that has to be defended
 * against being absent.
 */
function readNumberWord(s: string): { amount: number; rest: string } | null {
	for (const [word, amount] of Object.entries(NUMBER_WORDS)) {
		const lead = `${word} `;
		if (s.toLowerCase().startsWith(lead)) return { amount, rest: s.slice(lead.length) };
	}
	return null;
}

/**
 * Takes a measurement unit off the front of the text that follows a quantity, so
 * "200 g chicken" and "200g chicken" read alike. A first word that is not a
 * measurement is left where it is: "2 eggs" must keep its food and "2 large
 * eggs" its size, and the last word left in a phrase is never a unit.
 */
function readMeasureUnit(rest: string): { unit: string; rest: string } {
	const space = rest.indexOf(' ');
	if (space === -1) return { unit: '', rest };
	const unit = rest.slice(0, space).toLowerCase();
	if (classifyUnit(unit) === 'serving') return { unit: '', rest };
	return { unit, rest: rest.slice(space + 1) };
}

function parseQuantity(raw: string): { amount: number; unit: string; rest: string } {
	const s = raw.trim().replace(/^of\s+/, '');
	for (const { re, qty, restIndex, unitIndex } of QUANTITY_PATTERNS) {
		const m = s.match(re);
		if (!m) continue;
		const n = qty(m);
		if (n == null || !Number.isFinite(n)) continue;
		const glued = unitIndex === undefined ? '' : group(m, unitIndex).toLowerCase();
		const tail = group(m, restIndex);
		const read = glued ? { unit: glued, rest: tail } : readMeasureUnit(tail);
		return { amount: n, unit: read.unit, rest: read.rest };
	}
	const word = readNumberWord(s);
	if (word) {
		const read = readMeasureUnit(word.rest);
		return { amount: word.amount, unit: read.unit, rest: read.rest };
	}
	// Nothing led the phrase, so there is no unit to read either: a word that
	// happens to be a unit here belongs to the food ("cup of coffee").
	return { amount: 1, unit: '', rest: s };
}

function stripUnits(s: string) {
	const tokens = tokenize(s);
	// A phrase that is nothing but filler has no food to find, so nothing is
	// dropped from it and the caller keeps the text it started with.
	const food = tokens.findIndex((token) => !UNIT_HINTS.includes(token));
	return tokens.slice(Math.max(food, 0)).join(' ');
}

export function guessMeal(date = new Date()): Meal {
	const h = date.getHours();
	if (h >= 5 && h < 10) return 'breakfast';
	if (h >= 10 && h < 14) return 'lunch';
	if (h >= 14 && h < 17) return 'snack';
	if (h >= 17 && h < 22) return 'dinner';
	return 'snack';
}

/**
 * One food a sentence mentioned: the words left once the quantity was taken off
 * the front, and the quantity itself. No `foodId` and no name — nothing here
 * knows what food `query` names, and the servings cannot be worked out until
 * something does, because a mass has to be divided by that food's own serving
 * weight.
 */
export type ParsedChunk = {
	query: string;
	quantity: QuantitySpec;
	meal: Meal;
};

/** Split a sentence into the foods it mentions, each with its quantity. */
export function parseLocalText(text: string, meal: Meal = guessMeal()): ParsedChunk[] {
	const chunks = text
		// A slash separates items ("eggs / toast") unless between digits, where it
		// is a fraction ("1/2 avocado") that must survive to parseQuantity. A line
		// break separates too, so a pasted list reads as one food per line.
		//
		// The class is every line break, not just `\n`: a Windows clipboard brings
		// `\r` and a Word or PDF paste brings U+2028 or U+2029, and a list pasted
		// from one of those is a list all the same.
		.split(/\s*(?:,|;|\+|[\n\r\u2028\u2029]|(?<!\d)\/(?!\d)|\band\b)\s*/i)
		.map((c) => c.trim())
		.filter((c) => c.length > 1);

	return chunks.map((chunk) => {
		const { amount, unit, rest } = parseQuantity(chunk);
		return {
			query: stripUnits(rest) || rest,
			quantity: { amount, unit, kind: classifyUnit(unit) },
			meal
		};
	});
}

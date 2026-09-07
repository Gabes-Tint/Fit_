import { describe, expect, it } from 'vitest';
import { guessMeal, parseLocalText } from './parse-text';
import type { QuantitySpec } from './quantity';
import type { Meal } from './types';

/**
 * What the parser made of one phrase, without the meal every chunk also
 * carries: the words left for the catalog, and the quantity read off the front.
 */
function reading(text: string): { query: string | undefined; quantity: QuantitySpec | undefined } {
	const chunk = parseLocalText(text, 'lunch')[0];
	return { query: chunk?.query, quantity: chunk?.quantity };
}

const queries = (text: string, meal: Meal = 'lunch') =>
	parseLocalText(text, meal).map((chunk) => chunk.query);

/** Hours either side of every boundary in `guessMeal`, plus the small hours. */
const MEAL_HOURS: [hour: number, meal: Meal][] = [
	[0, 'snack'],
	[4, 'snack'],
	[5, 'breakfast'],
	[9, 'breakfast'],
	[10, 'lunch'],
	[13, 'lunch'],
	[14, 'snack'],
	[16, 'snack'],
	[17, 'dinner'],
	[21, 'dinner'],
	[22, 'snack'],
	[23, 'snack']
];

/**
 * What one phrase comes to: the words left for the catalog to name, and the
 * quantity read off the front. Nothing here says which food that is — since
 * #116 the parser has no opinion about that, and `/api/foods/resolve` does.
 */
type ChunkCase = [text: string, query: string, quantity: QuantitySpec];

const servings = (amount: number, unit = ''): QuantitySpec => ({ amount, unit, kind: 'serving' });
const mass = (amount: number, unit: string): QuantitySpec => ({ amount, unit, kind: 'mass' });
const volume = (amount: number, unit: string): QuantitySpec => ({ amount, unit, kind: 'volume' });

const NUMBER_WORD_CASES: ChunkCase[] = [
	['a banana', 'banana', servings(1)],
	['an apple', 'apple', servings(1)],
	['one banana', 'banana', servings(1)],
	['two eggs', 'eggs', servings(2)],
	['three eggs', 'eggs', servings(3)],
	['four eggs', 'eggs', servings(4)],
	['five eggs', 'eggs', servings(5)],
	['six eggs', 'eggs', servings(6)],
	['seven eggs', 'eggs', servings(7)],
	['eight eggs', 'eggs', servings(8)],
	['nine eggs', 'eggs', servings(9)],
	['ten almonds', 'almonds', servings(10)],
	['half avocado', 'avocado', servings(0.5)],
	['dozen eggs', 'eggs', servings(12)]
];

// '×' is the multiplication sign, which people get from a phone keyboard.
const WRITTEN_NUMBER_CASES: ChunkCase[] = [
	['1/2 avocado', 'avocado', servings(0.5)],
	['1/ 2 avocado', 'avocado', servings(0.5)],
	['1 /2 avocado', 'avocado', servings(0.5)],
	['0.5 avocado', 'avocado', servings(0.5)],
	['2 x eggs', 'eggs', servings(2)],
	['2 × eggs', 'eggs', servings(2)],
	['2x eggs', 'eggs', servings(2)],
	['12.5 x brown rice', 'brown rice', servings(12.5)],
	// Neither half of a fraction is a single digit here: a chocolate bar scored
	// into 16 squares, ten of them eaten.
	['10/16 chocolate bar', 'chocolate bar', servings(0.625)]
];

const GLUED_UNIT_CASES: ChunkCase[] = [
	['150g brown rice', 'brown rice', mass(150, 'g')],
	['12.5g almonds', 'almonds', mass(12.5, 'g')],
	['8oz salmon', 'salmon', mass(8, 'oz')],
	['1cup oats', 'oats', volume(1, 'cup')],
	// `slice` is not a measurement, so it stays a count of servings.
	['1slice toast', 'toast', servings(1, 'slice')],
	['2slices toast', 'toast', servings(2, 'slices')],
	// Issue #111: a long spelling glued to the number reads the same unit as
	// its short form.
	['2tablespoons peanut butter', 'peanut butter', volume(2, 'tablespoons')],
	// The period in "tbsp." has to be escaped before it joins the alternation
	// regex, or a mutant that drops it instead of escaping it would fail to glue
	// "tbsp." at all, leaving the whole phrase as the query.
	['3tbsp. peanut butter', 'peanut butter', volume(3, 'tbsp.')],
	// The other half of that escape: unescaped, the period would match any
	// character, so "tbsp7" would be read as a unit the table never held.
	['3tbsp7 peanut butter', '3tbsp7 peanut butter', servings(1)]
];

/** One phrase per unit word the parser drops before it hands the query over. */
const UNIT_WORD_CASES: ChunkCase[] = [
	['2 large eggs', 'eggs', servings(2)],
	['1 medium banana', 'banana', servings(1)],
	['1 small apple', 'apple', servings(1)],
	['1 slice sourdough', 'sourdough', servings(1)],
	['2 slices toast', 'toast', servings(2)],
	['1 cup oats', 'oats', volume(1, 'cup')],
	['2 cups brown rice', 'brown rice', volume(2, 'cups')],
	['2 tbsp peanut butter', 'peanut butter', volume(2, 'tbsp')],
	// Issue #111: the long spelling, its plural, and any case must read the
	// same volume unit as the short form above.
	['2 tablespoons peanut butter', 'peanut butter', volume(2, 'tablespoons')],
	['2 Tablespoons peanut butter', 'peanut butter', volume(2, 'tablespoons')],
	['2 tbsp. peanut butter', 'peanut butter', volume(2, 'tbsp.')],
	['1 tsp honey', 'honey', volume(1, 'tsp')],
	['1 teaspoon honey', 'honey', volume(1, 'teaspoon')],
	['250 ml milk', 'milk', volume(250, 'ml')],
	['250 millilitres milk', 'milk', volume(250, 'millilitres')],
	['1 scoop whey', 'whey', servings(1)],
	['2 scoops whey', 'whey', servings(2)],
	['1 can tuna', 'tuna', servings(1)],
	['2 cans tuna', 'tuna', servings(2)],
	['1 bar dark chocolate', 'dark chocolate', servings(1)],
	['1 bowl oats', 'oats', servings(1)],
	['1 piece salmon', 'salmon', servings(1)],
	['2 pieces salmon', 'salmon', servings(2)],
	['4 oz salmon', 'salmon', mass(4, 'oz')],
	['150 g brown rice', 'brown rice', mass(150, 'g')],
	['150 grams brown rice', 'brown rice', mass(150, 'grams')],
	['1 gram honey', 'honey', mass(1, 'gram')]
];

describe('guessMeal', () => {
	it.each(MEAL_HOURS)('calls %i:00 %s', (hour, meal) => {
		expect(guessMeal(new Date(2026, 0, 1, hour))).toBe(meal);
	});
});

describe('parseLocalText', () => {
	it.each(NUMBER_WORD_CASES)('reads "%s" as %s, %o', (text, query, quantity) => {
		expect(reading(text)).toEqual({ query, quantity });
	});

	it.each(WRITTEN_NUMBER_CASES)('reads "%s" as %s, %o', (text, query, quantity) => {
		expect(reading(text)).toEqual({ query, quantity });
	});

	it.each(GLUED_UNIT_CASES)(
		'reads "%s", with the unit glued to the number, as %s, %o',
		(text, query, quantity) => {
			expect(reading(text)).toEqual({ query, quantity });
		}
	);

	it.each(UNIT_WORD_CASES)(
		'reads the unit word in "%s" and asks for %s, %o',
		(text, query, quantity) => {
			expect(reading(text)).toEqual({ query, quantity });
		}
	);

	it('defaults to a single serving when no quantity is given', () => {
		expect(reading('coffee')).toEqual({ query: 'coffee', quantity: servings(1) });
	});

	it('drops a leading "of" before reading the quantity', () => {
		expect(reading('of two eggs')).toEqual({ query: 'eggs', quantity: servings(2) });
	});

	it('drops a leading "of" and every space behind it, not just the first', () => {
		expect(reading('of  two eggs')).toEqual({ query: 'eggs', quantity: servings(2) });
	});

	it('keeps an "of" that belongs to the food name rather than to the filler', () => {
		expect(reading('2 cans cream of mushroom soup')).toEqual({
			query: 'cream of mushroom soup',
			quantity: servings(2)
		});
	});

	it('drops the unit and the "of" between a quantity and its food', () => {
		expect(reading('2 slices of toast')).toEqual({ query: 'toast', quantity: servings(2) });
	});

	it('reads a number only at the start of a phrase, not in the middle of one', () => {
		expect(reading('rice 2 cups')).toEqual({ query: 'rice 2 cups', quantity: servings(1) });
	});

	it('reads a fraction only at the start of a phrase, not in the middle of one', () => {
		expect(reading('rice 1/2 cup')).toEqual({ query: 'rice 1/2 cup', quantity: servings(1) });
	});

	it('refuses a fraction that divides by zero rather than proposing endless servings', () => {
		expect(reading('1/0 avocado')).toEqual({ query: '1/0 avocado', quantity: servings(1) });
	});

	it('lowercases the query, so a shouted food is the same query as a quiet one', () => {
		expect(reading('2 Slices TOAST')).toEqual({ query: 'toast', quantity: servings(2) });
	});

	it('leaves no leading space on the query when the number word was followed by two', () => {
		expect(reading('a  banana')).toEqual({ query: 'banana', quantity: servings(1) });
	});

	it('still reads the unit when a second space was typed after the fraction', () => {
		expect(reading('1/2  cup rice')).toEqual({ query: 'rice', quantity: volume(0.5, 'cup') });
	});

	it('still reads the unit when a second space was typed after the number', () => {
		expect(reading('200  g chicken')).toEqual({ query: 'chicken', quantity: mass(200, 'g') });
	});

	it('still reads the unit when a second space was typed after the multiplier', () => {
		expect(reading('2 x  cup of tea')).toEqual({ query: 'tea', quantity: volume(2, 'cup') });
	});

	it('splits a sentence on commas into separate items', () => {
		expect(queries('two eggs, black coffee')).toEqual(['eggs', 'black coffee']);
	});

	it('splits on the word "and"', () => {
		expect(queries('eggs and coffee')).toEqual(['eggs', 'coffee']);
	});

	it('splits on a semicolon and on a plus', () => {
		expect(queries('coffee; toast + eggs')).toEqual(['coffee', 'toast', 'eggs']);
	});

	it('splits on a slash between words but keeps one between digits as a fraction', () => {
		const chunks = parseLocalText('1/2 avocado, eggs / toast', 'lunch');
		expect(chunks.map((chunk) => chunk.query)).toEqual(['avocado', 'eggs', 'toast']);
		expect(chunks.map((chunk) => chunk.quantity.amount)).toEqual([0.5, 1, 1]);
	});

	it('splits a pasted list on its line breaks', () => {
		expect(queries('two eggs\nblack coffee')).toEqual(['eggs', 'black coffee']);
	});

	// A Windows clipboard pastes `\r`, and Word and PDF paste the two Unicode
	// separators. A list pasted from any of them is still a list.
	it.each([
		['a carriage return', '\r'],
		['a line separator', '\u2028'],
		['a paragraph separator', '\u2029']
	])('splits a pasted list on %s too', (_name, br) => {
		expect(queries(`two eggs${br}black coffee`)).toEqual(['eggs', 'black coffee']);
	});

	it('splits even when the separator has no space after it', () => {
		expect(queries('eggs,toast')).toEqual(['eggs', 'toast']);
	});

	it('drops the empty fragment a doubled separator leaves behind', () => {
		expect(queries('two eggs,, toast')).toEqual(['eggs', 'toast']);
	});

	it('drops a one-letter fragment, trailing space and all', () => {
		expect(queries('two eggs, a ')).toEqual(['eggs']);
	});

	it('assigns the requested meal to every chunk', () => {
		expect(parseLocalText('eggs, coffee', 'dinner').map((chunk) => chunk.meal)).toEqual([
			'dinner',
			'dinner'
		]);
	});

	it('guesses the meal when none was named', () => {
		expect(parseLocalText('eggs')[0]?.meal).toBe(guessMeal());
	});

	it('reads through the article in "half an avocado"', () => {
		expect(reading('half an avocado')).toEqual({ query: 'avocado', quantity: servings(0.5) });
	});

	it('reads through the article after a fraction, which no number word swallowed', () => {
		expect(reading('1/2 a cucumber')).toEqual({ query: 'cucumber', quantity: servings(0.5) });
	});

	it('reads through the unit and the "of" in "a cup of coffee"', () => {
		expect(reading('a cup of coffee')).toEqual({ query: 'coffee', quantity: volume(1, 'cup') });
	});

	it('keeps a phrase that is nothing but filler rather than asking for nothing', () => {
		expect(reading('3 cups')).toEqual({ query: 'cups', quantity: servings(3) });
	});

	it('takes the unit off even when the food left behind is itself a filler word', () => {
		expect(reading('250 ml can')).toEqual({ query: 'can', quantity: volume(250, 'ml') });
	});

	it('has nothing to ask about an empty sentence', () => {
		expect(parseLocalText('')).toEqual([]);
	});

	it('keeps the unit lowercased, however it was typed', () => {
		expect(reading('200 G chicken breast')).toEqual({
			query: 'chicken breast',
			quantity: mass(200, 'g')
		});
		expect(reading('150G brown rice')).toEqual({ query: 'brown rice', quantity: mass(150, 'g') });
	});
});

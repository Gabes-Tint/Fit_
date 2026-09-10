import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import { searchFoods } from './foods';
import { searchTerms } from './query';
import { headRetryTerms, namesBrand, searchPlainFood, type Ranked } from './plain-food';

let db: DatabaseSync;

const names = (typed: string, limit = 10) => searchFoods(db, typed, limit).map((food) => food.name);

beforeEach(() => {
	db = createFixtureCatalog();
});

afterEach(() => {
	db.close();
});

describe('the defect this rule exists for (#337)', () => {
	it('is reproduced by the fixture: nothing generic matches "green apple" at all', () => {
		const matched = db
			.prepare(
				`select f.kind from food_fts join food f on f.food_id = food_fts.rowid
				where food_fts match '"green"* AND "apple"*'`
			)
			.all()
			.map((row) => row['kind']);
		expect(matched).toEqual(['branded']);
	});

	it('puts the fruit on the page, under the rows the query actually matched', () => {
		// The candy is what "green apple" matches, so the candy leads. The fruit
		// the strict match never held is reachable underneath it instead of
		// absent — and the brand beside the name is what tells them apart.
		expect(names('green apple')).toEqual(['GREEN APPLE', 'Apples, granny smith, with skin, raw']);
	});

	it('answers with the candy first when the person names its brand', () => {
		expect(names('claeys green apple')[0]).toBe('GREEN APPLE');
	});
});

describe('a compound food is not a plain food with a modifier', () => {
	it('answers "cauliflower rice" with cauliflower rice, not with rice', () => {
		// Measured on the live catalog before this was appended rather than
		// merged: "cauliflower rice" answered with black rice at 360 kcal for a
		// 24 kcal vegetable. "chickpea pasta", "zucchini noodles" and "cashew
		// cheese" all failed the same way, and no rule can read a compound food
		// apart from a modified one by its text.
		expect(names('cauliflower rice')[0]).toBe('CAULIFLOWER RICE');
	});

	it('still offers the head noun underneath, rather than a page of one row', () => {
		expect(names('cauliflower rice')).toContain('Rice, white, long-grain, regular, raw, enriched');
	});
});

describe('namesBrand', () => {
	it('reads a brand written as one label out of the typed text', () => {
		expect(namesBrand('claeys green apple', 'CLAEYS')).toBe(true);
	});

	it('does not credit a brand the text never mentions', () => {
		expect(namesBrand('green apple', 'CLAEYS')).toBe(false);
	});

	it('reads a multi-word brand as the label it is printed as', () => {
		expect(namesBrand('burger king whopper', 'BURGER KING')).toBe(true);
	});

	it('reads a brand the ETL carried through padded and title-cased', () => {
		// `food.brand` is free text from several sources merged together, so the
		// same brand arrives "CLAEYS" from one and "  Claeys " from another.
		expect(namesBrand('claeys green apple', '  Claeys  ')).toBe(true);
	});

	it('credits a three-letter brand, which is a brand and not a fragment', () => {
		expect(namesBrand('kfc bowl', 'KFC')).toBe(true);
	});

	it('a row with no brand is never a brand the query named', () => {
		expect(namesBrand('green apple', null)).toBe(false);
	});

	it('a brand the ETL carried through blank is not one either', () => {
		expect(namesBrand('green apple', '   ')).toBe(false);
	});

	it('is still no brand when the typed text left a gap for one to hide in', () => {
		// A doubled space between typed words is two adjacent separators, which
		// is exactly the shape an empty brand takes once it is padded.
		expect(namesBrand('green  apple', '   ')).toBe(false);
	});

	describe('a brand is whole words, never a run of letters inside one', () => {
		// All three are real brands in the catalog, and a substring test exempted
		// every row carrying them from the demotion for a word nobody typed.
		it('does not read NAN out of "banana"', () => {
			expect(namesBrand('banana', 'NAN')).toBe(false);
		});

		it('does not read EAS out of "chicken breast"', () => {
			expect(namesBrand('chicken breast', 'EAS')).toBe(false);
		});

		it('does not read LIVE out of "olive oil"', () => {
			expect(namesBrand('olive oil', 'LIVE')).toBe(false);
		});

		it('still reads a brand that is the first word of the query', () => {
			expect(namesBrand('nan formula', 'NAN')).toBe(true);
		});

		it('still reads a brand that is the last word of the query', () => {
			expect(namesBrand('formula nan', 'NAN')).toBe(true);
		});
	});
});

describe('headRetryTerms', () => {
	const branded = { id: 1, brand: 'CLAEYS', kind: 'branded' };

	it('widens a query answered with branded rows and no brand of its own', () => {
		expect(headRetryTerms('green apple', [branded])?.text).toBe('apple');
	});

	it('leaves a page alone when a food is already in it to rank', () => {
		expect(
			headRetryTerms('green apple', [branded, { id: 2, brand: null, kind: 'generic' }])
		).toBeNull();
	});

	it('leaves a page alone when the person named one of its brands', () => {
		expect(headRetryTerms('claeys green apple', [branded])).toBeNull();
	});

	it('does not widen a single-token query, which has no qualifier to drop', () => {
		expect(headRetryTerms('apple', [branded])).toBeNull();
	});

	it('does not widen a query that matched nothing: that is a different answer', () => {
		expect(headRetryTerms('green apple', [])).toBeNull();
	});

	it('reads past the gaps a typed query leaves', () => {
		// A trailing space and a doubled one between words; the head is still
		// "apple", not the empty string between two separators, which would
		// widen the query into a search for nothing.
		expect(headRetryTerms('green  apple ', [branded])?.text).toBe('apple');
	});
});

describe('searchPlainFood', () => {
	/** A branded row naming no brand of its own, which is what makes a page hopeless. */
	function branded(id: number, food: string): Ranked<string> {
		return { id, brand: null, kind: 'branded', food };
	}

	function generic(id: number, food: string): Ranked<string> {
		return { id, brand: null, kind: 'generic', food };
	}

	/** Answers the strict terms with one page and anything else with the other. */
	function pages(strict: Ranked<string>[], relaxed: Ranked<string>[]) {
		return vi.fn((used: { text: string }, limit: number) =>
			(used.text === 'green apple' ? strict : relaxed).slice(0, limit)
		);
	}

	const TERMS = searchTerms('green apple') ?? { match: '', text: 'green apple' };

	it('hands back the strict page untouched when it already holds a food', () => {
		// The widened page is stocked, so a page that widened when it should not
		// have would visibly grow rather than come back looking the same.
		const strict = [generic(1, 'Apples, granny smith, with skin, raw'), branded(2, 'CANDY')];
		const merged = searchPlainFood(TERMS, 10, pages(strict, [generic(3, 'Apple, raw')]));
		expect(merged).toEqual(['Apples, granny smith, with skin, raw', 'CANDY']);
	});

	it('does not widen a single-token query, whatever its page looks like', () => {
		const single = searchTerms('apple') ?? { match: '', text: 'apple' };
		const run = vi.fn((used: { text: string }, limit: number) =>
			(used.text === 'apple' ? [branded(1, 'APPLE')] : [generic(2, 'Apple, raw')]).slice(0, limit)
		);
		expect(searchPlainFood(single, 10, run)).toEqual(['APPLE']);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('appends the widened page under the strict one, never above it', () => {
		const merged = searchPlainFood(
			TERMS,
			10,
			pages([branded(1, 'GREEN APPLE')], [generic(2, 'Apple, raw')])
		);
		expect(merged).toEqual(['GREEN APPLE', 'Apple, raw']);
	});

	it('shows a row the query matched once, not again under its head noun', () => {
		const merged = searchPlainFood(
			TERMS,
			10,
			pages([branded(1, 'GREEN APPLE')], [generic(2, 'Apple, raw'), branded(1, 'GREEN APPLE')])
		);
		expect(merged).toEqual(['GREEN APPLE', 'Apple, raw']);
	});

	it('never answers with more rows than the page a caller asked for', () => {
		const merged = searchPlainFood(
			TERMS,
			2,
			pages([branded(1, 'GREEN APPLE')], [generic(2, 'Apple, raw'), generic(3, 'Apple, baked')])
		);
		expect(merged).toEqual(['GREEN APPLE', 'Apple, raw']);
	});

	it('does not widen a page the strict match already filled', () => {
		// `resolveFood` reads three rows, and a three-row page is nearly always
		// full: a widening whose rows would all be cut is a second query for
		// nothing, and the rows it would have added are rows nobody asked for.
		const run = pages([branded(1, 'GREEN APPLE'), branded(2, 'GREEN APPLE SOUR')], []);
		expect(searchPlainFood(TERMS, 2, run)).toEqual(['GREEN APPLE', 'GREEN APPLE SOUR']);
		expect(run).toHaveBeenCalledTimes(1);
	});
});

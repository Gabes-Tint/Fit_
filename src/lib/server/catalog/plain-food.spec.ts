import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import { searchFoods } from './foods';
import { searchTerms } from './query';
import { headTerms, namesBrand, needsHeadRetry, searchPlainFood, type Ranked } from './plain-food';

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

	it('answers "green apple" with the fruit, not with Claeys hard candy', () => {
		expect(names('green apple')[0]).toBe('Apples, granny smith, with skin, raw');
	});

	it('still answers with the candy, because a demotion is not a filter', () => {
		expect(names('green apple')).toContain('GREEN APPLE');
	});

	it('answers with the candy first when the person names its brand', () => {
		expect(names('claeys green apple')[0]).toBe('GREEN APPLE');
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

	it('a row with no brand is never a brand the query named', () => {
		expect(namesBrand('green apple', null)).toBe(false);
	});

	it('reads a brand the ETL carried through padded and title-cased', () => {
		// `food.brand` is free text from several sources merged together, so the
		// same brand arrives "CLAEYS" from one and "  Claeys " from another, and
		// a person types neither spelling exactly.
		expect(namesBrand('claeys green apple', '  Claeys  ')).toBe(true);
	});

	it('credits a three-letter brand, which is a brand and not a fragment', () => {
		// The floor is "shorter than a token search would accept", not "three or
		// fewer": KFC, GNC and Yeo are brands a person types and expects back.
		expect(namesBrand('kfc bowl', 'KFC')).toBe(true);
	});

	it('ignores a brand too short to mean anything, rather than matching inside a word', () => {
		// "ap" would otherwise match inside "apple" and exempt the row from the
		// demotion, which is the floor `query.ts` puts on a typed token too.
		expect(namesBrand('green apple', 'ap')).toBe(false);
	});
});

describe('needsHeadRetry', () => {
	const branded = { id: 1, brand: 'CLAEYS', kind: 'branded' };

	it('retries a query answered with branded rows and no brand of its own', () => {
		expect(needsHeadRetry('green apple', [branded])).toBe(true);
	});

	it('leaves a page alone when a food is already in it to rank', () => {
		expect(needsHeadRetry('green apple', [branded, { id: 2, brand: null, kind: 'generic' }])).toBe(
			false
		);
	});

	it('leaves a page alone when the person named one of its brands', () => {
		expect(needsHeadRetry('claeys green apple', [branded])).toBe(false);
	});

	it('does not widen a single-token query, which has no qualifier to drop', () => {
		expect(needsHeadRetry('apple', [branded])).toBe(false);
	});

	it('does not widen a query that matched nothing: that is a different answer', () => {
		expect(needsHeadRetry('green apple', [])).toBe(false);
	});
});

describe('headTerms', () => {
	it('reads the last word as the head of a food phrase', () => {
		expect(headTerms('green apple')?.text).toBe('apple');
	});

	it('has no head to read out of a single word', () => {
		expect(headTerms('apple')).toBeNull();
	});

	it('reads past the gaps a typed query leaves', () => {
		// A person types a trailing space and a doubled one between words; the
		// head is still "apple", not the empty string between two separators,
		// which would search for nothing and answer a widened query with a blank.
		expect(headTerms('green  apple ')?.text).toBe('apple');
	});
});

describe('searchPlainFood', () => {
	/** A branded row naming no brand of its own, which is what makes a page hopeless. */
	function branded(id: number, score: number, food: string): Ranked<string> {
		return { id, brand: null, kind: 'branded', score, food };
	}

	function generic(id: number, score: number, food: string): Ranked<string> {
		return { id, brand: null, kind: 'generic', score, food };
	}

	/** Answers the strict terms with one page and anything else with the other. */
	function pages(strict: Ranked<string>[], relaxed: Ranked<string>[]) {
		return (used: { text: string }, limit: number) =>
			(used.text === 'green apple' ? strict : relaxed).slice(0, limit);
	}

	const TERMS = searchTerms('green apple') ?? { match: '', text: 'green apple' };

	it('hands back the strict page untouched when it already holds a food', () => {
		const strict = [generic(1, 9, 'Apples, granny smith, with skin, raw'), branded(2, 8, 'CANDY')];
		expect(searchPlainFood(TERMS, 10, pages(strict, []))).toEqual([
			'Apples, granny smith, with skin, raw',
			'CANDY'
		]);
	});

	it('merges the widened page into the strict one, best score first', () => {
		const merged = searchPlainFood(
			TERMS,
			10,
			pages([branded(1, 5, 'GREEN APPLE')], [generic(2, 7, 'Apple, raw'), branded(1, 5, 'ignored')])
		);
		// The fruit the strict match never held, and the candy still on the page
		// below it — a demotion is not a filter, and neither is this.
		expect(merged).toEqual(['Apple, raw', 'GREEN APPLE']);
	});

	it('keeps the higher-scoring copy of a row both pages found', () => {
		// The same food, scored against two different queries. Being found twice
		// is not a reason to rank it by its worse showing.
		const merged = searchPlainFood(
			TERMS,
			10,
			pages(
				[branded(1, 6, 'GREEN APPLE at 6')],
				[generic(2, 4, 'Apple, raw'), branded(1, 2, 'GREEN APPLE at 2')]
			)
		);
		expect(merged).toEqual(['GREEN APPLE at 6', 'Apple, raw']);
	});

	it('never answers with more rows than the page a caller asked for', () => {
		const merged = searchPlainFood(
			TERMS,
			2,
			pages(
				[branded(1, 5, 'GREEN APPLE')],
				[generic(2, 9, 'Apple, raw'), generic(3, 8, 'Apple, baked')]
			)
		);
		expect(merged).toEqual(['Apple, raw', 'Apple, baked']);
	});
});

import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import { searchFoods } from './foods';
import { headTerms, namesBrand, needsHeadRetry } from './plain-food';

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
});

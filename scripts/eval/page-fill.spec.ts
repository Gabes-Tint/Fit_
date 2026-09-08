import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureCatalog } from '../../tests/catalog-fixture';
import { searchFoods, pageSize } from '../../src/lib/server/catalog/foods';
import { searchTerms } from '../../src/lib/server/catalog/query';
import fixture from '../../data/eval/search-queries.json' with { type: 'json' };
import {
	availableFoods,
	collapseKey,
	NAME_SCAN_FACTOR,
	pageFillFailure,
	pageFillRows,
	pageFillViolations,
	type PageFillMeasurement
} from './page-fill';

let db: DatabaseSync;

/** The FTS expression for what a person typed, which is all `availableFoods` needs. */
const matching = (typed: string): string => {
	const terms = searchTerms(typed);
	if (terms === null) throw new Error(`"${typed}" is not searchable`);
	return terms.match;
};

const available = (typed: string, limit: number): number =>
	availableFoods(db, matching(typed), limit);

const measure = (typed: string, limit: number): PageFillMeasurement => ({
	query: typed,
	means: 'what a person typing this is owed',
	available: available(typed, limit),
	returned: searchFoods(db, typed, limit).length
});

beforeEach(() => {
	db = createFixtureCatalog();
});

afterEach(() => {
	db.close();
});

describe('the defect this guard exists for (#275)', () => {
	/**
	 * The fixture catalog carries the #106 crowd: 501 rows all named "PASTA"
	 * beside three distinct generic pasta rows. Collapsed correctly that is four
	 * foods; collapsed after the page was cut it was one.
	 */
	it('sees a collapse that P@3 cannot', () => {
		const full = searchFoods(db, 'pasta', 10).map((food) => food.name);
		expect(full.length).toBe(4);

		// What the bug looked like from the outside: the same first row, and
		// nothing behind it.
		const collapsed = full.slice(0, 1);
		const precisionAt3 = (names: string[]): number => {
			const top = names.slice(0, 3);
			return top.filter((name) => name.toLowerCase().startsWith('pasta')).length / top.length;
		};
		// The metric the gate used could not fall — it rose.
		expect(precisionAt3(collapsed)).toBeGreaterThanOrEqual(precisionAt3(full));

		// The metric this module adds falls, and says by how much.
		const catalogHas = available('pasta', 10);
		expect(catalogHas).toBe(4);
		expect(
			pageFillViolations([
				{ query: 'pasta', means: 'pasta', available: catalogHas, returned: collapsed.length }
			])
		).toHaveLength(1);
	});

	it('passes the search as it actually ranks, so the guard is not failing on principle', () => {
		expect(
			pageFillViolations(['pasta', 'chicken', 'milk'].map((typed) => measure(typed, 10)))
		).toEqual([]);
	});
});

describe('what the catalog has', () => {
	it('counts distinct foods, not the rows carrying their names', () => {
		// 501 rows named PASTA and three generic ones.
		expect(available('pasta', 50)).toBe(4);
	});

	it('reads one trailing "s" as the same food, the way the collapse does', () => {
		expect(collapseKey('MILK')).toBe(collapseKey('Milks'));
		expect(collapseKey('  Milk  ')).toBe('milk');
		// Three letters or fewer keep their "s"; `singular` carries that floor, so
		// "gas" is not read as a plural of "ga".
		expect(collapseKey('Gas')).toBe('gas');
	});

	it('does not merge two foods that merely share a word', () => {
		expect(collapseKey('Milk, dried')).not.toBe(collapseKey('MILK'));
	});

	it('stops at the page size, because a fuller count is a number nothing reads', () => {
		expect(available('chicken', 2)).toBe(2);
		expect(available('chicken', 50)).toBe(5);
	});

	it('answers nothing for a query the catalog has no food for', () => {
		expect(available('gravel', 50)).toBe(0);
	});

	it('scans enough names to fill a page even where every one has a plural twin', () => {
		// At most two lowered names — "milk" and "milks" — share a key, so
		// scanning this multiple of the page always yields at least a page of keys.
		expect(NAME_SCAN_FACTOR).toBeGreaterThanOrEqual(2);
	});
});

describe('the verdict', () => {
	const owed = (returned: number): PageFillMeasurement => ({
		query: 'ice cream',
		means: 'the deepest collapse in the catalog',
		available: 50,
		returned
	});

	it('is silent when the page is full', () => {
		expect(pageFillViolations([owed(50)])).toEqual([]);
	});

	it('fires on a page the search left short', () => {
		expect(pageFillViolations([owed(1)])).toEqual([owed(1)]);
	});

	it('names the query, the loss, and what a person meant by it', () => {
		const message = pageFillFailure([owed(1)], 50);
		expect(message).toContain('#106');
		expect(message).toContain('ice cream: 1 of 50 foods');
		expect(message).toContain('the deepest collapse in the catalog');
	});

	it('reports what the catalog had beside what search answered', () => {
		expect(pageFillRows([owed(1)])).toEqual([
			['query', 'catalog', 'search'],
			['ice cream', '50', '1']
		]);
	});
});

describe('the fixture', () => {
	it('measures page fill at the largest page /api/foods will serve', () => {
		expect(fixture.pageFill.limit).toBe(pageSize(String(Number.MAX_SAFE_INTEGER)));
	});

	it('names queries the search can actually run, so none scores an empty page by typo', () => {
		for (const entry of fixture.pageFill.queries) {
			expect(searchTerms(entry.query), entry.query).not.toBeNull();
		}
	});

	it('says what each query means, because the failure has to read as a product loss', () => {
		for (const entry of fixture.pageFill.queries) {
			expect(entry.means.length, entry.query).toBeGreaterThan(0);
		}
	});
});

import { describe, expect, it } from 'vitest';
import { ZERO_MICROS, type LogItem } from './types';
import { readsAsServings, usualServings } from './usual-portion';

/** A logged entry, with only the fields this module reads varied. */
function logged(
	name: string,
	date: string,
	servings: number,
	extra: Partial<LogItem> = {}
): LogItem {
	return {
		id: `l-${date}-${servings}`,
		foodId: null,
		date,
		meal: 'lunch',
		servings,
		source: 'manual',
		name,
		kcal: 140,
		protein: 2,
		carbs: 17,
		fat: 7,
		micros: ZERO_MICROS,
		servingLabel: '1 oz',
		grams: 28,
		brand: 'DORITOS',
		...extra
	};
}

/**
 * The catalog food behind those entries. Its own id never reaches the log —
 * `logFromCatalogFood` stores `foodId: null` — so name and brand are what tie
 * the two together, and are all `RememberedFood` asks for.
 */
const CHIPS = { name: 'Nacho Cheese Tortilla Chips', brand: 'DORITOS' };

const EGGS = { name: 'Egg, large', brand: undefined };

describe('usualServings', () => {
	it('is the amount of the only entry for the food', () => {
		expect(usualServings([logged('Nacho Cheese Tortilla Chips', '2026-09-01', 1.607)], CHIPS)).toBe(
			1.607
		);
	});

	it('matches a catalog food to its entries by name and brand, not by id', () => {
		// The entry carries `foodId: null` (`logFromCatalogFood`), so an
		// implementation keyed on the food's own id would answer null here.
		const log = [logged('Nacho Cheese Tortilla Chips', '2026-09-01', 2)];
		expect(usualServings(log, CHIPS)).toBe(2);
	});

	it('keeps two brands of the same food apart', () => {
		const log = [logged('Nacho Cheese Tortilla Chips', '2026-09-01', 2, { brand: 'Store' })];
		expect(usualServings(log, CHIPS)).toBeNull();
	});

	it('is null for a food this person has never logged', () => {
		expect(usualServings([logged('Egg, large', '2026-09-01', 2)], CHIPS)).toBeNull();
	});

	it('is null for an empty log', () => {
		expect(usualServings([], CHIPS)).toBeNull();
	});

	it('is null when the row being opened has no catalog food behind it yet', () => {
		expect(usualServings([logged('Egg, large', '2026-09-01', 3)], undefined)).toBeNull();
	});

	it('reads the food it was asked about, not the one logged beside it', () => {
		const log = [
			logged('Nacho Cheese Tortilla Chips', '2026-09-02', 1.5),
			logged('Egg, large', '2026-09-03', 4, { brand: undefined })
		];
		expect(usualServings(log, EGGS)).toBe(4);
	});

	it('takes the latest date even when the log is not in date order', () => {
		// A synced document is two devices' entries merged, so nothing promises
		// the array is sorted: reading the tail would answer 0.5 here.
		const log = [
			logged('Nacho Cheese Tortilla Chips', '2026-09-05', 2),
			logged('Nacho Cheese Tortilla Chips', '2026-09-01', 0.5)
		];
		expect(usualServings(log, CHIPS)).toBe(2);
	});

	it('takes the last one logged among several on the same day', () => {
		// `date` is a calendar day and cannot separate two entries within one;
		// the log is appended to, so the later of the two is further along it.
		const log = [
			logged('Nacho Cheese Tortilla Chips', '2026-09-05', 1, { id: 'l-1' }),
			logged('Nacho Cheese Tortilla Chips', '2026-09-05', 2.25, { id: 'l-2' })
		];
		expect(usualServings(log, CHIPS)).toBe(2.25);
	});

	it('keeps a seeded entry apart from a catalog row of the same name', () => {
		// A seeded food keeps its own stable id, and the History list treats the
		// two as different foods for that reason. Answering with the seeded
		// amount here would make the card and that list disagree.
		const log = [logged('Nacho Cheese Tortilla Chips', '2026-09-01', 3, { foodId: 'f-chips' })];
		expect(usualServings(log, CHIPS)).toBeNull();
	});

	it('remembers a food logged long before the History list would still list it', () => {
		// The 60-day window belongs to a list somebody browses; this is a food
		// they have just named themselves.
		const log = [logged('Nacho Cheese Tortilla Chips', '2020-01-01', 3)];
		expect(usualServings(log, CHIPS)).toBe(3);
	});
});

describe('readsAsServings', () => {
	it('accepts the label serving', () => {
		expect(readsAsServings(1)).toBe(true);
	});

	it('accepts every amount the stepper can reach', () => {
		expect(readsAsServings(0.125)).toBe(true);
		expect(readsAsServings(0.5)).toBe(true);
		expect(readsAsServings(1.5)).toBe(true);
		expect(readsAsServings(2.875)).toBe(true);
	});

	it('refuses the arithmetic behind a typed weight', () => {
		// 45 g of a 28 g serving. Nobody taps their way to 1.607 servings, so
		// showing it back as a count of servings shows a number never chosen.
		expect(readsAsServings(1.607)).toBe(false);
		expect(readsAsServings(0.179)).toBe(false);
	});
});

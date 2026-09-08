import { describe, expect, it } from 'vitest';
import { ZERO_MICROS, type LogItem } from './types';
import { readsAsServings, usualServings } from './usual-portion';

/** A logged entry, with only the three fields this module reads varied. */
function logged(foodId: string | null, date: string, servings: number): LogItem {
	return {
		id: `${foodId}-${date}-${servings}`,
		foodId,
		date,
		meal: 'lunch',
		servings,
		source: 'manual',
		name: 'Nacho Cheese Tortilla Chips',
		kcal: 140,
		protein: 2,
		carbs: 17,
		fat: 7,
		micros: ZERO_MICROS,
		servingLabel: '1 oz',
		grams: 28
	};
}

const CHIPS = 'catalog-9002';
const EGGS = 'catalog-9001';

describe('usualServings', () => {
	it('is the amount of the only entry for the food', () => {
		expect(usualServings([logged(CHIPS, '2026-09-01', 1.607)], CHIPS)).toBe(1.607);
	});

	it('is null for a food this person has never logged', () => {
		expect(usualServings([logged(EGGS, '2026-09-01', 2)], CHIPS)).toBeNull();
	});

	it('is null for an empty log', () => {
		expect(usualServings([], CHIPS)).toBeNull();
	});

	it('is null when the row being opened has no catalog food behind it', () => {
		expect(usualServings([logged(null, '2026-09-01', 3)], null)).toBeNull();
	});

	it('reads the food it was asked about, not the one logged beside it', () => {
		const log = [logged(CHIPS, '2026-09-02', 1.5), logged(EGGS, '2026-09-03', 4)];
		expect(usualServings(log, CHIPS)).toBe(1.5);
	});

	it('takes the latest date even when the log is not in date order', () => {
		// A synced document is two devices' entries merged, so nothing promises
		// the array is sorted: reading the tail would answer 0.5 here.
		const log = [logged(CHIPS, '2026-09-05', 2), logged(CHIPS, '2026-09-01', 0.5)];
		expect(usualServings(log, CHIPS)).toBe(2);
	});

	it('takes the last entry added among several on the same day', () => {
		// `date` is a day, so it cannot separate two entries within one day; the
		// later one in the array is the later one logged.
		const log = [logged(CHIPS, '2026-09-05', 1), logged(CHIPS, '2026-09-05', 2.25)];
		expect(usualServings(log, CHIPS)).toBe(2.25);
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

import { describe, expect, it } from 'vitest';
import { ZERO_MICROS } from './types';
import type { LogItem } from './types';
import { addDaysISO } from './utils';
import {
	MAX_RECENT_FOODS,
	mostFrequentFoods,
	mostRecentFoods,
	RECENT_WINDOW_DAYS
} from './recent-foods';

const TODAY = '2026-06-15';

function item(overrides: Partial<LogItem> = {}): LogItem {
	return {
		id: 'l-1',
		foodId: null,
		date: TODAY,
		meal: 'breakfast',
		servings: 1,
		source: 'manual',
		name: 'Oatmeal',
		kcal: 150,
		protein: 5,
		carbs: 27,
		fat: 3,
		micros: ZERO_MICROS,
		servingLabel: '1 cup',
		...overrides
	};
}

describe('mostRecentFoods', () => {
	it('groups entries that share a name and brand across null foodIds', () => {
		const log = [
			item({ id: 'l-1', date: TODAY, name: 'Oatmeal', brand: 'Quaker' }),
			item({ id: 'l-2', date: addDaysISO(TODAY, -1), name: 'Oatmeal', brand: 'Quaker' })
		];
		const foods = mostRecentFoods(log, TODAY);
		expect(foods).toHaveLength(1);
		expect(foods[0]?.count).toBe(2);
	});

	it('groups the same food regardless of case or surrounding whitespace', () => {
		const log = [
			item({ id: 'l-1', name: ' Oatmeal ', brand: 'Quaker' }),
			item({ id: 'l-2', name: 'oatmeal', brand: 'QUAKER' })
		];
		const foods = mostRecentFoods(log, TODAY);
		expect(foods).toHaveLength(1);
		expect(foods[0]?.count).toBe(2);
	});

	it('keeps foods with the same name but different brands apart', () => {
		const log = [
			item({ id: 'l-1', name: 'Yogurt', brand: 'Store Brand' }),
			item({ id: 'l-2', name: 'Yogurt', brand: 'Fage' })
		];
		expect(mostRecentFoods(log, TODAY)).toHaveLength(2);
	});

	it('groups seeded foods by their stable foodId even if the name changed since', () => {
		const log = [
			item({ id: 'l-1', foodId: 'egg-large', name: 'Egg, large' }),
			item({ id: 'l-2', foodId: 'egg-large', name: 'Large Egg' })
		];
		const foods = mostRecentFoods(log, TODAY);
		expect(foods).toHaveLength(1);
		expect(foods[0]?.count).toBe(2);
	});

	it('orders distinct foods by the date they were most recently logged', () => {
		const log = [
			item({ id: 'l-1', name: 'Toast', date: addDaysISO(TODAY, -5) }),
			item({ id: 'l-2', name: 'Eggs', date: addDaysISO(TODAY, -1) }),
			item({ id: 'l-3', name: 'Coffee', date: TODAY })
		];
		expect(mostRecentFoods(log, TODAY).map((f) => f.source.name)).toEqual([
			'Coffee',
			'Eggs',
			'Toast'
		]);
	});

	it('breaks a tie on last-logged date the same way on every call', () => {
		const log = [
			item({ id: 'l-1', name: 'Zebra Cake', date: TODAY }),
			item({ id: 'l-2', name: 'Apple', date: TODAY })
		];
		const first = mostRecentFoods(log, TODAY).map((f) => f.source.name);
		const second = mostRecentFoods(log, TODAY).map((f) => f.source.name);
		expect(first).toEqual(second);
	});

	it('excludes an entry logged before the window', () => {
		const log = [
			item({ id: 'l-1', name: 'Old Soup', date: addDaysISO(TODAY, -(RECENT_WINDOW_DAYS + 1)) })
		];
		expect(mostRecentFoods(log, TODAY)).toHaveLength(0);
	});

	it('includes an entry logged exactly at the window boundary', () => {
		const log = [
			item({ id: 'l-1', name: 'Boundary Soup', date: addDaysISO(TODAY, -RECENT_WINDOW_DAYS) })
		];
		expect(mostRecentFoods(log, TODAY)).toHaveLength(1);
	});

	it('caps the list at MAX_RECENT_FOODS even with more foods logged', () => {
		const log = Array.from({ length: MAX_RECENT_FOODS + 8 }, (_, i) =>
			item({ id: `l-${i}`, name: `Food ${i}`, date: addDaysISO(TODAY, -i) })
		);
		expect(mostRecentFoods(log, TODAY)).toHaveLength(MAX_RECENT_FOODS);
	});

	it('carries the servings the food was last logged at, not an earlier one', () => {
		const log = [
			item({ id: 'l-1', name: 'Rice', servings: 0.5, date: addDaysISO(TODAY, -3) }),
			item({ id: 'l-2', name: 'Rice', servings: 2, date: TODAY })
		];
		expect(mostRecentFoods(log, TODAY)[0]?.source.servings).toBe(2);
	});

	it('derives kcal for one serving from the most recent entry', () => {
		const log = [item({ id: 'l-1', name: 'Rice', servings: 2, kcal: 400 })];
		expect(mostRecentFoods(log, TODAY)[0]?.kcalPerServing).toBe(200);
	});

	it('shows the stored total, not a division by zero, for an entry logged at zero servings', () => {
		const log = [item({ id: 'l-1', name: 'Soup can', servings: 0, kcal: 220 })];
		expect(mostRecentFoods(log, TODAY)[0]?.kcalPerServing).toBe(220);
	});

	it('returns nothing for an empty log', () => {
		expect(mostRecentFoods([], TODAY)).toEqual([]);
	});

	it('carries the whole most-recent entry as `source`, not just its display fields', () => {
		// `relogItem` (log-entry.ts) rescales off `foodId` and `micros`, neither
		// of which a summary row shows -- a tap has to hand back the real entry,
		// not re-derive it from a key a second data structure would have to
		// agree with.
		const log = [item({ id: 'l-1', foodId: 'egg-large', name: 'Egg, large', servings: 2 })];
		const source = mostRecentFoods(log, TODAY)[0]?.source;
		expect(source).toEqual(log[0]);
	});
});

describe('mostFrequentFoods', () => {
	it('orders distinct foods by how many times each was logged', () => {
		const log = [
			item({ id: 'l-1', name: 'Banana', date: addDaysISO(TODAY, -1) }),
			item({ id: 'l-2', name: 'Banana', date: TODAY }),
			item({ id: 'l-3', name: 'Steak', date: TODAY })
		];
		expect(mostFrequentFoods(log, TODAY).map((f) => f.source.name)).toEqual(['Banana', 'Steak']);
	});

	it('breaks an equal-count tie by whichever food was logged more recently', () => {
		const log = [
			item({ id: 'l-1', name: 'Toast', date: addDaysISO(TODAY, -2) }),
			item({ id: 'l-2', name: 'Bagel', date: TODAY })
		];
		expect(mostFrequentFoods(log, TODAY).map((f) => f.source.name)).toEqual(['Bagel', 'Toast']);
	});

	it('breaks an equal-count, equal-date tie the same way on every call', () => {
		const log = [
			item({ id: 'l-1', name: 'Zebra Cake', date: TODAY }),
			item({ id: 'l-2', name: 'Apple', date: TODAY })
		];
		const first = mostFrequentFoods(log, TODAY).map((f) => f.source.name);
		const second = mostFrequentFoods(log, TODAY).map((f) => f.source.name);
		expect(first).toEqual(second);
	});
});

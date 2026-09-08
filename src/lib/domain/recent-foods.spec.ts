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

function names(foods: { source: LogItem }[]): string[] {
	return foods.map((food) => food.source.name);
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
		// `foodIdentity` decides this; the list is what makes it visible, as one
		// row rather than two.
		const log = [
			item({ id: 'l-1', name: ' Oatmeal ', brand: ' Quaker ' }),
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
		// Named so that date order and alphabetical order disagree: a list that
		// happened to be alphabetical would say nothing about dates.
		const log = [
			item({ id: 'l-1', name: 'Apple', date: addDaysISO(TODAY, -5) }),
			item({ id: 'l-2', name: 'Banana', date: addDaysISO(TODAY, -1) }),
			item({ id: 'l-3', name: 'Cherry', date: TODAY })
		];
		expect(names(mostRecentFoods(log, TODAY))).toEqual(['Cherry', 'Banana', 'Apple']);
	});

	it('lists foods last logged on the same day in one order, whatever order the log lists them', () => {
		// Two foods eaten the same day have nothing left to sort them by, and a
		// list that reshuffled between two openings of the same screen would look
		// broken. Alphabetical is the settled answer, and it does not depend on
		// which entry an import happened to append first.
		const sameDay = [
			item({ id: 'l-1', name: 'Zebra Cake', date: TODAY }),
			item({ id: 'l-2', name: 'Muesli', date: TODAY }),
			item({ id: 'l-3', name: 'Apple', date: TODAY })
		];
		const expected = ['Apple', 'Muesli', 'Zebra Cake'];
		expect(names(mostRecentFoods(sameDay, TODAY))).toEqual(expected);
		expect(names(mostRecentFoods([...sameDay].reverse(), TODAY))).toEqual(expected);
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

	it('excludes an entry dated after today', () => {
		// A device whose clock ran ahead can write tomorrow's date onto today's
		// breakfast. It is not something eaten lately, and letting it in would
		// pin it to the top of the list until the calendar caught up.
		const log = [item({ id: 'l-1', name: 'Tomorrow Toast', date: addDaysISO(TODAY, 1) })];
		expect(mostRecentFoods(log, TODAY)).toHaveLength(0);
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

	it('reads the last portion off the latest date, not off the end of the log', () => {
		// An import appends whatever the file held, so an older entry can land
		// after a newer one -- with a larger id, since it was written later. The
		// date is what decides which portion this food was last eaten at.
		const log = [
			item({ id: 'l-3', name: 'Rice', servings: 2, date: TODAY }),
			item({ id: 'l-9', name: 'Rice', servings: 0.5, date: addDaysISO(TODAY, -3) })
		];
		expect(mostRecentFoods(log, TODAY)[0]?.source.servings).toBe(2);
	});

	it('takes the later of two entries logged on one day, in either log order', () => {
		// A calendar date cannot separate breakfast from supper. `uid()` builds an
		// id from the clock, so the larger id is the later entry -- and that stays
		// true however the two are ordered in the array.
		const second = item({ id: 'l-2', name: 'Rice', servings: 2, date: TODAY });
		const first = item({ id: 'l-1', name: 'Rice', servings: 0.5, date: TODAY });
		expect(mostRecentFoods([second, first], TODAY)[0]?.source.servings).toBe(2);
		expect(mostRecentFoods([first, second], TODAY)[0]?.source.servings).toBe(2);
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
	it('puts the food logged most often first, ahead of one logged more recently', () => {
		// "What do I usually eat" is a question about habit, so a count beats both
		// of the tiebreaks under it: Steak here is neither the most recent nor the
		// first alphabetically.
		const log = [
			item({ id: 'l-1', name: 'Steak', date: addDaysISO(TODAY, -2) }),
			item({ id: 'l-2', name: 'Steak', date: addDaysISO(TODAY, -1) }),
			item({ id: 'l-3', name: 'Apple', date: TODAY })
		];
		expect(names(mostFrequentFoods(log, TODAY))).toEqual(['Steak', 'Apple']);
	});

	it('breaks an equal-count tie by whichever food was logged more recently', () => {
		const log = [
			item({ id: 'l-1', name: 'Apple', date: addDaysISO(TODAY, -2) }),
			item({ id: 'l-2', name: 'Zebra Cake', date: TODAY })
		];
		expect(names(mostFrequentFoods(log, TODAY))).toEqual(['Zebra Cake', 'Apple']);
	});

	it('lists foods tied on count and date in one order, whatever order the log lists them', () => {
		const sameDay = [
			item({ id: 'l-1', name: 'Zebra Cake', date: TODAY }),
			item({ id: 'l-2', name: 'Muesli', date: TODAY }),
			item({ id: 'l-3', name: 'Apple', date: TODAY })
		];
		const expected = ['Apple', 'Muesli', 'Zebra Cake'];
		expect(names(mostFrequentFoods(sameDay, TODAY))).toEqual(expected);
		expect(names(mostFrequentFoods([...sameDay].reverse(), TODAY))).toEqual(expected);
	});

	it('caps the list at MAX_RECENT_FOODS even with more foods logged', () => {
		const log = Array.from({ length: MAX_RECENT_FOODS + 8 }, (_, i) =>
			item({ id: `l-${i}`, name: `Food ${i}`, date: addDaysISO(TODAY, -i) })
		);
		expect(mostFrequentFoods(log, TODAY)).toHaveLength(MAX_RECENT_FOODS);
	});
});

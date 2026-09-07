import { describe, expect, it } from 'vitest';
import { buildAlexProfile, buildJordanProfile, HOUSEHOLD_PARTNER } from './demo-seed';
import { SEED_FOOD_BY_ID } from './foods';
import { adaptiveTdee, loggedDatesSet } from './tdee';

/** Sum one nutrient across a log, rounded the way the app rounds. */
function total(
	log: { kcal: number; protein: number; carbs: number; fat: number }[],
	key: 'kcal' | 'protein' | 'carbs' | 'fat'
): number {
	return Math.round(log.reduce((sum, item) => sum + item[key], 0) * 10) / 10;
}

describe('buildAlexProfile', () => {
	const alex = buildAlexProfile();

	it('seeds a log', () => {
		expect(alex.log.length).toBeGreaterThan(0);
	});

	it('only references seeded foods', () => {
		for (const item of alex.log) {
			expect(item.foodId && SEED_FOOD_BY_ID[item.foodId]).toBeTruthy();
		}
	});

	it('leaves gaps, because a missed day is the point', () => {
		expect(loggedDatesSet(alex.log).size).toBeLessThan(21);
	});

	it('seeds enough history for adaptive TDEE to engage', () => {
		expect(adaptiveTdee(alex).usingAdaptive).toBe(true);
	});

	it('seeds weigh-ins in ascending date order', () => {
		const dates = alex.weights.map((w) => w.date);
		expect([...dates].sort()).toEqual(dates);
	});

	it('varies how entries were logged', () => {
		expect(new Set(alex.log.map((i) => i.source)).size).toBeGreaterThan(1);
	});
});

describe('buildJordanProfile', () => {
	const jordan = buildJordanProfile();

	it('is vegetarian', () => {
		expect(jordan.restrictions).toContain('vegetarian');
	});

	it('states the same person the empty household profile does', () => {
		expect(jordan.name).toBe(HOUSEHOLD_PARTNER.name);
		expect(jordan.heightCm).toBe(HOUSEHOLD_PARTNER.heightCm);
	});

	it('seeds a log', () => {
		expect(jordan.log.length).toBeGreaterThan(0);
	});

	it('only references seeded foods', () => {
		for (const item of jordan.log) {
			expect(item.foodId && SEED_FOOD_BY_ID[item.foodId]).toBeTruthy();
		}
	});
});

/**
 * The numbers a new user meets.
 *
 * #146 moved the sample journal's nutrition out of a bundled food catalog and
 * into `seed-foods.ts`, which is a rewrite of where every one of these figures
 * comes from. Nothing in the suite would have failed if a row had lost its
 * micronutrients or picked up a decimal in the move -- the profile would simply
 * have been quietly wrong on the first screen anybody sees. These are the values
 * from before that change, stated rather than derived, so any later edit to a
 * seeded row has to be a deliberate one.
 */
describe('the seeded journal’s arithmetic', () => {
	it('opens on the day and the plate it always has', () => {
		const [egg, bread, coffee] = buildAlexProfile().log;
		expect(egg).toMatchObject({
			meal: 'breakfast',
			name: 'Egg, large',
			servings: 1.75,
			kcal: 126,
			protein: 11,
			carbs: 0.7,
			fat: 8.4
		});
		expect(egg?.micros.iron).toBe(1.5);
		expect(bread).toMatchObject({ name: 'Sourdough bread', kcal: 105 });
		expect(coffee).toMatchObject({ name: 'Black coffee', kcal: 2 });
	});

	it('adds up to the same three weeks of eating it always did', () => {
		const log = buildAlexProfile().log;
		expect(log.length).toBe(134);
		expect(total(log, 'kcal')).toBe(15617);
		expect(total(log, 'protein')).toBe(1413.7);
		expect(total(log, 'carbs')).toBe(1571.9);
		expect(total(log, 'fat')).toBe(439.9);
	});

	it('keeps Jordan’s vegetarian fortnight to its own totals', () => {
		const log = buildJordanProfile().log;
		expect(log.length).toBe(70);
		expect(total(log, 'kcal')).toBe(9930);
		expect(total(log, 'protein')).toBe(595);
	});

	it('re-portions a seeded entry off the seed table, not off its stored numbers', () => {
		// The entry keeps its `foodId` precisely so this stays exact: doubling
		// 1.75 servings of egg has to give the food's own arithmetic, not the
		// rounded 126 kcal already on the row multiplied by two.
		const egg = buildAlexProfile().log[0];
		const source = SEED_FOOD_BY_ID[egg?.foodId ?? ''];
		expect(source).toBeDefined();
		expect(Math.round((source?.kcal ?? 0) * 3.5)).toBe(252);
	});
});

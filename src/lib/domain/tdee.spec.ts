import { describe, expect, it } from 'vitest';
import { emptyProfile } from './profile';
import { SEED_FOOD_BY_ID, scaleFood } from './foods';
import {
	adaptiveTdee,
	calmWeeks,
	computeTargets,
	estimatedTdee,
	goalDelta,
	latestWeight,
	linearSlope,
	loggedDatesSet,
	microTargets,
	mifflinStJeor,
	nutritionForDay,
	rollingAverages
} from './tdee';
import type { LogItem, Meal, Profile, WeightEntry } from './types';
import { ZERO_MICROS } from './types';
import { addDaysISO, todayISO, uid } from './utils';

const END = '2026-06-30';

function entry(date: string, foodId: string, servings: number, meal: Meal = 'lunch'): LogItem {
	const food = SEED_FOOD_BY_ID[foodId];
	if (!food) throw new Error(`test fixture references unknown food: ${foodId}`);
	const scaled = scaleFood(food, servings);
	return {
		id: uid('l-'),
		foodId,
		date,
		meal,
		servings,
		source: 'manual',
		name: scaled.name,
		kcal: scaled.kcal,
		protein: scaled.protein,
		carbs: scaled.carbs,
		fat: scaled.fat,
		micros: scaled.micros,
		provenance: scaled.provenance,
		servingLabel: scaled.servingLabel,
		brand: scaled.brand
	};
}

/**
 * An entry whose numbers are set here, not read from the catalog, so the
 * arithmetic is hand-checkable and a nutrition edit can't move the expectation.
 */
function portions(date: string, count: number, meal: Meal = 'lunch'): LogItem {
	return {
		id: uid('l-'),
		foodId: null,
		date,
		meal,
		servings: count,
		source: 'manual',
		name: 'Reference portion',
		kcal: 100 * count,
		protein: 10 * count,
		carbs: 20 * count,
		fat: 3 * count,
		micros: {
			...ZERO_MICROS,
			fiber: 4 * count,
			sodium: 200 * count,
			potassium: 300 * count,
			iron: 2 * count,
			calcium: 50 * count,
			magnesium: 30 * count,
			vitaminB12: 1 * count,
			vitaminD: 5 * count
		},
		provenance: 'lab',
		servingLabel: '1 portion'
	};
}

function profileWith(overrides: Partial<Profile> = {}): Profile {
	return { ...emptyProfile({ name: 'Test' }), ...overrides };
}

/** `days` consecutive days ending at END, each logged at 500 kcal. */
function loggedRun(days: number, count = 5): LogItem[] {
	return Array.from({ length: days }, (_, i) => portions(addDaysISO(END, -(days - 1 - i)), count));
}

function weighInRun(count: number, startKg: number, kgPerReading: number): WeightEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		id: uid('w-'),
		// Every other day, so `count` readings span roughly 2*count days.
		date: addDaysISO(END, -((count - 1 - i) * 2)),
		kg: startKg + i * kgPerReading
	}));
}

/**
 * Weigh-ins at the given day offsets before END, sitting exactly on a line of
 * `kgPerDay` from `startKg` at the earliest offset. The least-squares slope is
 * then that same `kgPerDay`, so the reported trend is arithmetic, not a guess.
 */
function trendWeighIns(offsets: number[], startKg: number, kgPerDay: number): WeightEntry[] {
	const earliest = Math.max(...offsets);
	return offsets.map((daysBefore) => ({
		id: uid('w-'),
		date: addDaysISO(END, -daysBefore),
		kg: startKg + (earliest - daysBefore) * kgPerDay
	}));
}

describe('mifflinStJeor', () => {
	it('adds the male constant', () => {
		const base = 10 * 80 + 6.25 * 180 - 5 * 30;
		expect(mifflinStJeor({ sex: 'male', age: 30, heightCm: 180 }, 80)).toBe(base + 5);
	});

	it('subtracts the female constant', () => {
		const base = 10 * 65 + 6.25 * 165 - 5 * 30;
		expect(mifflinStJeor({ sex: 'female', age: 30, heightCm: 165 }, 65)).toBe(base - 161);
	});

	it('uses a midpoint constant for other', () => {
		const base = 10 * 70 + 6.25 * 170 - 5 * 30;
		expect(mifflinStJeor({ sex: 'other', age: 30, heightCm: 170 }, 70)).toBe(base - 78);
	});
});

describe('latestWeight', () => {
	it('returns the most recent reading regardless of array order', () => {
		// Three readings, shuffled: the answer is the chronologically last one,
		// not the last element of the array and not the middle of the sort.
		expect(
			latestWeight([
				{ id: 'b', date: '2026-02-01', kg: 71 },
				{ id: 'a', date: '2026-01-01', kg: 75 },
				{ id: 'c', date: '2026-03-01', kg: 69 }
			])
		).toBe(69);
	});

	it('falls back when there are no readings', () => {
		expect(latestWeight([], 66)).toBe(66);
	});

	it('sorts before picking the latest, when the array-last entry is not the chronological last', () => {
		// The array's last element is the earliest reading; skipping the sort
		// (or a comparator that leaves order unspecified) would answer with
		// that one instead of the one actually logged most recently.
		expect(
			latestWeight([
				{ id: 'a', date: '2026-03-01', kg: 60 },
				{ id: 'b', date: '2026-01-01', kg: 75 }
			])
		).toBe(60);
	});
});

describe('linearSlope', () => {
	// linearSlope is only ever called through weightTrend with at least four
	// points, so it is exported here to pin its own edge cases directly.

	it('is zero with fewer than two points', () => {
		expect(linearSlope([])).toBe(0);
		expect(linearSlope([{ x: 0, y: 5 }])).toBe(0);
	});

	it('fits the exact line through two points', () => {
		// A rising line of slope 2: y = 2x.
		expect(
			linearSlope([
				{ x: 0, y: 0 },
				{ x: 2, y: 4 }
			])
		).toBe(2);
	});

	it('reads a falling trend as a negative slope, not a positive one', () => {
		// A losing streak must read as negative kg/day, never as gaining.
		const points = [
			{ x: 0, y: 10 },
			{ x: 1, y: 8 },
			{ x: 2, y: 6 }
		];
		expect(linearSlope(points)).toBe(-2);
	});

	it('fits a rising trend across more than two points', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 2 },
			{ x: 2, y: 4 }
		];
		expect(linearSlope(points)).toBe(2);
	});
});

describe('estimatedTdee', () => {
	it('scales the basal rate by the activity factor', () => {
		const sedentary = estimatedTdee(profileWith({ activity: 'sedentary' }));
		const active = estimatedTdee(profileWith({ activity: 'active' }));
		expect(active).toBeGreaterThan(sedentary);
	});
});

describe('goalDelta', () => {
	it('cuts for losing', () => {
		expect(goalDelta('lose')).toBe(-400);
	});

	it('adds for gaining', () => {
		expect(goalDelta('gain')).toBe(250);
	});

	it('applies a gentler cut on GLP-1', () => {
		expect(goalDelta('glp1')).toBe(-250);
	});

	it('leaves maintenance alone', () => {
		expect(goalDelta('maintain')).toBe(0);
	});
});

describe('nutritionForDay', () => {
	it('adds up every tracked field, not only the calories', () => {
		// One portion plus two makes three portions' worth of each field. The
		// micronutrients are accumulated one line apiece, so each one is
		// checked: a single line summing the wrong way must be visible here.
		const log = [portions('2026-06-01', 1), portions('2026-06-01', 2)];
		expect(nutritionForDay(log, '2026-06-01')).toEqual({
			kcal: 300,
			protein: 30,
			carbs: 60,
			fat: 9,
			fiber: 12,
			sodium: 600,
			potassium: 900,
			iron: 6,
			calcium: 150,
			vitaminB12: 3,
			vitaminD: 15,
			magnesium: 90,
			count: 2
		});
	});

	it('returns zeros for an unlogged day rather than throwing', () => {
		expect(nutritionForDay([], '2026-06-01')).toMatchObject({ kcal: 0, protein: 0, count: 0 });
	});

	it('ignores entries from other days', () => {
		const log = [entry('2026-06-01', 'egg-large', 2)];
		expect(nutritionForDay(log, '2026-06-02').kcal).toBe(0);
	});
});

describe('rollingAverages', () => {
	it('averages over logged days only, never treating a miss as zero', () => {
		const oneDay = nutritionForDay([entry(END, 'chicken-breast', 3)], END);
		// Two logged days inside a seven-day window: the average must equal a
		// single day's intake, not two-sevenths of it.
		const log = [entry(END, 'chicken-breast', 3), entry(addDaysISO(END, -3), 'chicken-breast', 3)];
		const { avg, loggedDays } = rollingAverages(log, 7, END);
		expect(loggedDays).toBe(2);
		expect(Math.round(avg.kcal)).toBe(Math.round(oneDay.kcal));
	});

	it('reports zero logged days for an empty log', () => {
		expect(rollingAverages([], 7, END).loggedDays).toBe(0);
	});
});

describe('loggedDatesSet', () => {
	it('collapses repeated dates while keeping the distinct ones', () => {
		const log = [
			entry('2026-06-01', 'coffee', 1),
			entry('2026-06-01', 'egg-large', 1),
			entry('2026-06-02', 'coffee', 1)
		];
		expect(loggedDatesSet(log)).toEqual(new Set(['2026-06-01', '2026-06-02']));
	});
});

describe('adaptiveTdee', () => {
	/**
	 * Reference history: fourteen days at 500 kcal, four weigh-ins five days
	 * apart at 0.1 kg a day; every number asserted below is arithmetic on those.
	 */
	function adaptiveProfile() {
		return profileWith({
			log: loggedRun(14),
			weights: trendWeighIns([15, 10, 5, 0], 80, -0.1)
		});
	}

	it('falls back to the formula without enough history', () => {
		const p = profileWith({ log: loggedRun(3), weights: weighInRun(2, 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.usingAdaptive).toBe(false);
		expect(result.inferred).toBe(result.fallback);
		// Two readings are too few to fit a line through, so the trend reads as
		// flat rather than as whatever those two points happen to suggest.
		expect(result.sampleSize).toBe(2);
		expect(result.kgPerWeek).toBe(0);
		expect(result.weightSpanDays).toBe(0);
	});

	it('switches to the inferred burn once there is enough history', () => {
		const result = adaptiveTdee(adaptiveProfile(), END);
		expect(result.usingAdaptive).toBe(true);
		expect(result.loggedDays).toBe(14);
		expect(result.sampleSize).toBe(4);
		expect(result.windowDays).toBe(21);
		expect(result.avgIntake).toBe(500);
	});

	it('infers a burn above intake when weight is falling', () => {
		const result = adaptiveTdee(adaptiveProfile(), END);
		// 0.1 kg a day is 770 kcal a day of stored energy released, so eating
		// 500 kcal a day while losing it means burning 1270.
		expect(result.inferred).toBe(1270);
		expect(result.inferred).toBeGreaterThan(result.avgIntake);
	});

	it('reports a negative weekly trend when weight is falling', () => {
		const result = adaptiveTdee(adaptiveProfile(), END);
		expect(result.kgPerWeek).toBe(-0.7);
		// The span is measured from the first weigh-in to the last, not from
		// the start of the window.
		expect(result.weightSpanDays).toBe(15);
	});

	it('turns adaptive exactly at seven logged days, four weigh-ins and a ten-day span', () => {
		// Every threshold sits on its boundary at once: one fewer of anything
		// and the formula would still be in charge.
		const p = profileWith({ log: loggedRun(7), weights: trendWeighIns([10, 7, 3, 0], 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.loggedDays).toBe(7);
		expect(result.sampleSize).toBe(4);
		expect(result.weightSpanDays).toBe(10);
		expect(result.usingAdaptive).toBe(true);
		expect(result.inferred).toBe(1270);
	});

	it('stays on the formula with only six logged days', () => {
		const p = profileWith({ log: loggedRun(6), weights: trendWeighIns([10, 7, 3, 0], 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.loggedDays).toBe(6);
		expect(result.usingAdaptive).toBe(false);
		expect(result.inferred).toBe(result.fallback);
	});

	it('stays on the formula when four weigh-ins span only nine days', () => {
		const p = profileWith({ log: loggedRun(7), weights: trendWeighIns([9, 6, 3, 0], 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.weightSpanDays).toBe(9);
		expect(result.usingAdaptive).toBe(false);
		expect(result.inferred).toBe(result.fallback);
	});

	it('stays on the formula with three weigh-ins, however long the log', () => {
		const p = profileWith({ log: loggedRun(7), weights: trendWeighIns([10, 5, 0], 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.sampleSize).toBe(3);
		expect(result.usingAdaptive).toBe(false);
		// Three points would fit a line, but not one worth acting on.
		expect(result.kgPerWeek).toBe(0);
		expect(result.weightSpanDays).toBe(0);
	});

	it('stays on the formula when the weigh-ins are plentiful but the log is thin', () => {
		// Weight data alone cannot carry the estimate: without the intake side
		// there is nothing to subtract the energy balance from.
		const p = profileWith({ log: loggedRun(3), weights: trendWeighIns([10, 7, 3, 0], 80, -0.1) });
		const result = adaptiveTdee(p, END);
		expect(result.sampleSize).toBe(4);
		expect(result.loggedDays).toBe(3);
		expect(result.usingAdaptive).toBe(false);
		expect(result.inferred).toBe(result.fallback);
	});

	it('reports no trend when every weigh-in lands on the same day', () => {
		// Four readings on one morning span no time at all: the fit has nothing
		// to regress against and must answer zero rather than a NaN.
		const sameDay = [80, 79, 81, 80].map((kg) => ({ id: uid('w-'), date: END, kg }));
		const result = adaptiveTdee(profileWith({ log: loggedRun(14), weights: sameDay }), END);
		expect(result.sampleSize).toBe(4);
		expect(result.kgPerWeek).toBe(0);
		expect(result.weightSpanDays).toBe(0);
		expect(result.usingAdaptive).toBe(false);
	});

	it('counts only the weigh-ins inside the window, both boundaries included', () => {
		// The window is the 21 days ending at END, so it opens on 2026-06-10.
		// Deliberately out of order: the model sorts before it reads the span.
		const weights: WeightEntry[] = [
			{ id: 'w3', date: '2026-06-20', kg: 80 },
			{ id: 'w0', date: '2026-06-05', kg: 82 }, // five days before the window opens
			{ id: 'w1', date: '2026-06-10', kg: 81 }, // the first day of the window
			{ id: 'w5', date: '2026-07-01', kg: 78 }, // the day after END
			{ id: 'w4', date: '2026-06-30', kg: 79 }, // END itself
			{ id: 'w2', date: '2026-06-15', kg: 80.5 }
		];
		const result = adaptiveTdee(profileWith({ log: loggedRun(14), weights }), END);
		expect(result.sampleSize).toBe(4);
		expect(result.weightSpanDays).toBe(20);
		expect(result.kgPerWeek).toBe(-0.7);
	});

	it('reports no intake at all for a window with nothing logged', () => {
		const result = adaptiveTdee(profileWith(), END);
		expect(result.loggedDays).toBe(0);
		// Zero, not an average of no days.
		expect(result.avgIntake).toBe(0);
		expect(result.usingAdaptive).toBe(false);
	});

	it('clamps the inferred value into a physiologically plausible band', () => {
		// An implausible crash in weight would otherwise infer an absurd burn.
		const p = profileWith({ log: loggedRun(14), weights: weighInRun(8, 120, -3) });
		expect(adaptiveTdee(p, END).inferred).toBe(4200);
	});
});

describe('computeTargets', () => {
	it('derives the whole target set from the formula TDEE', () => {
		// The default profile: female, 32, 168 cm, no weigh-ins so 70 kg is
		// assumed. Basal 1429 kcal, light activity ×1.375 gives 1965, and the
		// cut takes 400 off that.
		const targets = computeTargets(profileWith());
		expect(targets.tdee.inferred).toBe(1965);
		expect(targets.kcal).toBe(1565);
		expect(targets.protein).toBe(112); // 1.6 g per kg
		expect(targets.fat).toBe(49); // 28% of the calories, at 9 kcal a gram
		expect(targets.carbs).toBe(169); // whatever is left, at 4 kcal a gram
		expect(targets.fiber).toBe(28);
	});

	it('honours a manual calorie override', () => {
		const targets = computeTargets(profileWith({ calorieOverride: 1800 }));
		expect(targets.kcal).toBe(1800);
		expect(targets.source).toBe('override');
	});

	it('reports the formula source before there is history', () => {
		expect(computeTargets(profileWith()).source).toBe('formula');
	});

	it('reports the adaptive source once there is enough history', () => {
		// computeTargets always calls adaptiveTdee against the real "today", so
		// the fixture history is built relative to it rather than to the fixed
		// END used elsewhere in this file.
		const end = todayISO();
		const log = Array.from({ length: 14 }, (_, i) => portions(addDaysISO(end, -(13 - i)), 5));
		const weights = [15, 10, 5, 0].map((daysBefore) => ({
			id: uid('w-'),
			date: addDaysISO(end, -daysBefore),
			kg: 80 - (15 - daysBefore) * 0.1
		}));
		const targets = computeTargets(profileWith({ log, weights }));
		expect(targets.tdee.usingAdaptive).toBe(true);
		expect(targets.source).toBe('adaptive');
	});

	it('asks for more protein on GLP-1', () => {
		const kg = [{ id: 'w', date: END, kg: 80 }];
		const plain = computeTargets(profileWith({ weights: kg }));
		const glp1 = computeTargets(profileWith({ weights: kg, glp1: true }));
		expect(plain.protein).toBe(128); // 1.6 g per kg
		expect(glp1.protein).toBe(144); // 1.8 g per kg
		expect(glp1.protein).toBeGreaterThan(plain.protein);
	});

	it('never sets a calorie target below the floor', () => {
		const tiny = profileWith({ age: 90, heightCm: 140, goal: 'lose' });
		expect(computeTargets(tiny).kcal).toBeGreaterThanOrEqual(1200);
	});

	it('keeps carbohydrates non-negative when protein is steered high', () => {
		const targets = computeTargets(profileWith({ proteinOverride: 400, calorieOverride: 1200 }));
		expect(targets.carbs).toBe(0);
	});

	it('honours a fibre override', () => {
		expect(computeTargets(profileWith({ fiberOverride: 45 })).fiber).toBe(45);
	});
});

describe('calmWeeks', () => {
	it('counts a week with four logged days', () => {
		const log = [0, 1, 2, 3].map((i) => entry(addDaysISO('2026-06-01', i), 'coffee', 1));
		expect(calmWeeks(log, 4, '2026-06-07')).toBe(1);
	});

	it('does not count a week with too few days', () => {
		const log = [0, 1].map((i) => entry(addDaysISO('2026-06-01', i), 'coffee', 1));
		expect(calmWeeks(log, 4, '2026-06-07')).toBe(0);
	});

	it('counts the current week on the Monday it begins', () => {
		// 2026-06-01 is a Monday. The week containing `end` is in scope even
		// when `end` is its very first day.
		const log = [0, 1, 2, 3].map((i) => entry(addDaysISO('2026-06-01', i), 'coffee', 1));
		expect(calmWeeks(log, 4, '2026-06-01')).toBe(1);
	});

	it('does not borrow the next week to reach a minimum', () => {
		// Three days in the week of 2026-06-01 and one on the following Monday:
		// neither week reaches four, and the Monday belongs to the second.
		const log = [
			...[0, 1, 2].map((i) => entry(addDaysISO('2026-06-01', i), 'coffee', 1)),
			entry('2026-06-08', 'coffee', 1)
		];
		expect(calmWeeks(log, 4, '2026-06-14')).toBe(0);
	});

	it('is zero for an empty log', () => {
		expect(calmWeeks([], 4, END)).toBe(0);
		// Even with no minimum to clear there is no week to count.
		expect(calmWeeks([], 0, END)).toBe(0);
	});

	it('does not reset on a missed week — earlier calm weeks still count', () => {
		const first = [0, 1, 2, 3].map((i) => entry(addDaysISO('2026-06-01', i), 'coffee', 1));
		const later = [0, 1, 2, 3].map((i) => entry(addDaysISO('2026-06-15', i), 'coffee', 1));
		// The later week is listed first, so counting has to start from the
		// earliest date logged rather than the first one it happens to meet.
		expect(calmWeeks([...later, ...first], 4, '2026-06-21')).toBe(2);
	});
});

describe('microTargets', () => {
	it('sets a higher iron target for women', () => {
		expect(microTargets(profileWith({ sex: 'female' })).iron).toBe(18);
		expect(microTargets(profileWith({ sex: 'male' })).iron).toBe(8);
	});

	it('sets a higher fibre target for men', () => {
		expect(microTargets(profileWith({ sex: 'male' })).fiber).toBe(38);
		expect(microTargets(profileWith({ sex: 'female' })).fiber).toBe(28);
	});
});

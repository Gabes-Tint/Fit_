import type { Activity, Goal, LogItem, Profile, WeightEntry } from './types';
import { isGlp1 } from './profile';
import { addDaysISO, lastNDates, parseISODate, startOfWeek, todayISO } from './utils';

const ACTIVITY_FACTOR: Record<Activity, number> = {
	sedentary: 1.2,
	light: 1.375,
	moderate: 1.55,
	active: 1.725
};

const KCAL_PER_KG = 7700;

export function mifflinStJeor(p: Pick<Profile, 'sex' | 'age' | 'heightCm'>, kg: number) {
	const base = 10 * kg + 6.25 * p.heightCm - 5 * p.age;
	if (p.sex === 'male') return base + 5;
	if (p.sex === 'female') return base - 161;
	return base - 78;
}

export function latestWeight(weights: WeightEntry[], fallbackKg = 70) {
	if (!weights.length) return fallbackKg;
	return [...weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.kg ?? fallbackKg;
}

export function estimatedTdee(profile: Profile) {
	const kg = latestWeight(profile.weights);
	return Math.round(mifflinStJeor(profile, kg) * ACTIVITY_FACTOR[profile.activity]);
}

/** A day's nutrition, all zero; the single place the tracked fields are listed. */
function emptyDay() {
	return {
		kcal: 0,
		protein: 0,
		carbs: 0,
		fat: 0,
		fiber: 0,
		sodium: 0,
		potassium: 0,
		iron: 0,
		calcium: 0,
		vitaminB12: 0,
		vitaminD: 0,
		magnesium: 0,
		count: 0
	};
}

export type DayNutrition = ReturnType<typeof emptyDay>;

/** Null rather than zeroes for an unlogged day: the two must never read alike. */
function dayTotals(log: LogItem[], date: string): DayNutrition | null {
	const items = log.filter((i) => i.date === date);
	if (!items.length) return null;
	return items.reduce((acc, i) => {
		acc.kcal += i.kcal;
		acc.protein += i.protein;
		acc.carbs += i.carbs;
		acc.fat += i.fat;
		acc.fiber += i.micros.fiber;
		acc.sodium += i.micros.sodium;
		acc.potassium += i.micros.potassium;
		acc.iron += i.micros.iron;
		acc.calcium += i.micros.calcium;
		acc.vitaminB12 += i.micros.vitaminB12;
		acc.vitaminD += i.micros.vitaminD;
		acc.magnesium += i.micros.magnesium;
		acc.count += 1;
		return acc;
	}, emptyDay());
}

/**
 * Least-squares slope of y over x. Exported so its edge cases — too few
 * points, an exact two-point line — can be pinned directly: every caller
 * today only ever reaches it with at least four points already, so those
 * edges are otherwise unreachable through the public API.
 */
export function linearSlope(points: { x: number; y: number }[]) {
	const n = points.length;
	if (n < 2) return 0;
	const meanX = points.reduce((s, p) => s + p.x, 0) / n;
	const meanY = points.reduce((s, p) => s + p.y, 0) / n;
	let num = 0;
	let den = 0;
	for (const p of points) {
		num += (p.x - meanX) * (p.y - meanY);
		den += (p.x - meanX) ** 2;
	}
	return den === 0 ? 0 : num / den;
}

export type AdaptiveTdee = {
	inferred: number;
	fallback: number;
	usingAdaptive: boolean;
	avgIntake: number;
	loggedDays: number;
	windowDays: number;
	kgPerWeek: number;
	weightSpanDays: number;
	sampleSize: number;
};

/** Least-squares kg/day over the weigh-ins, plus their span; zero with fewer than four readings. */
function weightTrend(weights: WeightEntry[]) {
	const first = weights[0];
	if (weights.length < 4 || !first) return { kgPerDay: 0, weightSpanDays: 0 };
	const t0 = parseISODate(first.date).getTime();
	const points = weights.map((w) => ({
		x: (parseISODate(w.date).getTime() - t0) / 86400000,
		y: w.kg
	}));
	return { kgPerDay: linearSlope(points), weightSpanDays: points.at(-1)?.x ?? 0 };
}

export function adaptiveTdee(profile: Profile, end = todayISO()): AdaptiveTdee {
	const fallback = estimatedTdee(profile);
	const windowDays = 21;
	const dates = lastNDates(windowDays, end);
	const start = dates[0] ?? end;

	const logged = dates
		.map((d) => dayTotals(profile.log, d))
		.filter((x): x is NonNullable<typeof x> => x !== null);

	const weights = profile.weights
		.filter((w) => w.date >= start && w.date <= end)
		.sort((a, b) => a.date.localeCompare(b.date));

	const avgIntake = logged.length > 0 ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;

	const { kgPerDay, weightSpanDays } = weightTrend(weights);

	const enough = logged.length >= 7 && weights.length >= 4 && weightSpanDays >= 10;

	const surplusKcalPerDay = kgPerDay * KCAL_PER_KG;
	const inferredRaw = avgIntake - surplusKcalPerDay;
	const inferred = Math.round(Math.min(4200, Math.max(1200, enough ? inferredRaw : fallback)));

	return {
		inferred,
		fallback,
		usingAdaptive: enough,
		avgIntake: Math.round(avgIntake),
		loggedDays: logged.length,
		windowDays,
		kgPerWeek: Math.round(kgPerDay * 7 * 100) / 100,
		weightSpanDays: Math.round(weightSpanDays),
		sampleSize: weights.length
	};
}

export function goalDelta(goal: Goal) {
	switch (goal) {
		case 'lose':
			return -400;
		case 'gain':
			return 250;
		case 'glp1':
			return -250;
		case 'maintain':
			return 0;
	}
}

export type Targets = {
	kcal: number;
	protein: number;
	carbs: number;
	fat: number;
	fiber: number;
	source: 'adaptive' | 'formula' | 'override';
	tdee: AdaptiveTdee;
};

export function computeTargets(profile: Profile): Targets {
	const tdee = adaptiveTdee(profile);
	const kg = latestWeight(profile.weights);
	const proteinPerKg = isGlp1(profile) ? 1.8 : 1.6;
	const protein = profile.proteinOverride ?? Math.round(Math.max(80, proteinPerKg * kg));
	const fiber = profile.fiberOverride ?? fiberTarget(profile);
	const kcal =
		profile.calorieOverride ?? Math.round(Math.max(1200, tdee.inferred + goalDelta(profile.goal)));
	const fat = Math.round((kcal * 0.28) / 9);
	const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
	return {
		kcal,
		protein,
		carbs,
		fat,
		fiber,
		source: profile.calorieOverride ? 'override' : tdee.usingAdaptive ? 'adaptive' : 'formula',
		tdee
	};
}

export function nutritionForDay(log: LogItem[], date: string): DayNutrition {
	return dayTotals(log, date) ?? emptyDay();
}

/**
 * Averages over the logged days only; an unlogged day is left out of the
 * divisor rather than counted as a zero.
 */
export function rollingAverages(log: LogItem[], days: number, end = todayISO()) {
	const dates = lastNDates(days, end);
	const logged = dates.map((d) => dayTotals(log, d)).filter((x): x is DayNutrition => x !== null);
	const sum = logged.reduce((acc, d) => {
		for (const k of Object.keys(acc) as (keyof DayNutrition)[]) {
			acc[k] += d[k];
		}
		return acc;
	}, emptyDay());
	const divisor = logged.length || 1;
	const avg = Object.fromEntries(
		Object.entries(sum).map(([k, v]) => [k, k === 'count' ? v : v / divisor])
	) as DayNutrition;
	return { avg, loggedDays: logged.length, dates };
}

export function loggedDatesSet(log: LogItem[]) {
	return new Set(log.map((i) => i.date));
}

const WEEK_OFFSETS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Weeks (Mon–Sun) with at least `minDays` logged. Never resets on a miss.
 *
 * The week count is sized up front from the date span rather than walked
 * with a `while (cursor <= end)` loop stepped by a mutable cursor: a loop
 * bounded that way hangs forever under a mutation that drops the step, and
 * this codebase's mutation ledger charges that timeout as debt even though
 * the mutation runner itself scores a timeout as a kill. Iterating a
 * pre-sized array instead means every mutation to the loop body still
 * terminates in a fixed number of steps, so it fails fast on a wrong answer
 * instead of hanging.
 */
export function calmWeeks(log: LogItem[], minDays = 4, end = todayISO()) {
	const dates = new Set(log.map((i) => i.date));
	if (!dates.size) return 0;
	const firstWeek = startOfWeek([...dates].sort()[0] ?? end);
	const spanDays = Math.round(
		(parseISODate(end).getTime() - parseISODate(firstWeek).getTime()) / 86400000
	);
	if (spanDays < 0) return 0;
	const totalWeeks = Math.floor(spanDays / 7) + 1;
	let count = 0;
	for (const week of Array.from({ length: totalWeeks }, (_, w) => w)) {
		const cursor = addDaysISO(firstWeek, week * 7);
		const n = WEEK_OFFSETS.filter((offset) => dates.has(addDaysISO(cursor, offset))).length;
		if (n >= minDays) count++;
	}
	return count;
}

/** The reference intake, before any override the profile carries. */
function fiberTarget(profile: Pick<Profile, 'sex'>) {
	return profile.sex === 'male' ? 38 : 28;
}

export function microTargets(profile: Profile) {
	const female = profile.sex !== 'male';
	return {
		fiber: fiberTarget(profile),
		sodium: 2300,
		potassium: 3400,
		iron: female ? 18 : 8,
		calcium: 1000,
		magnesium: female ? 320 : 420,
		vitaminB12: 2.4,
		vitaminD: 15
	};
}

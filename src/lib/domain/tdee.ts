import type { Activity, Goal, LogItem, Profile, WeightEntry } from './types';
import { isGlp1 } from './profile';
import { lastNDates, parseISODate, todayISO } from './utils';

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
	// No separate empty-array guard: sorting an empty array is a no-op, and
	// the optional chain plus `?? fallbackKg` already answer the same way.
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

/**
 * The journal indexed by date, in one pass, entries within a date keeping the
 * order the journal gave them.
 *
 * Exists because the windowed readers used to total each date by filtering
 * the whole journal for it, once per date in the window:
 * `adaptiveTdee`'s twenty-one day window cost twenty-one passes
 * over a journal that only grows, and `rollingAverages`' week cost seven.
 * Grouping once and reading the buckets is the same arithmetic over the same
 * entries in the same order — see `perf:today-log`.
 */
function byDate(log: LogItem[]): Map<string, LogItem[]> {
	const days = new Map<string, LogItem[]>();
	for (const item of log) {
		const day = days.get(item.date);
		if (day) day.push(item);
		else days.set(item.date, [item]);
	}
	return days;
}

/**
 * Null rather than zeroes for a day with nothing logged: an untouched day and
 * a day that came to zero must never read alike.
 */
function totalOf(items: LogItem[] | undefined): DayNutrition | null {
	if (!items?.length) return null;
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
 *
 * Zero for fewer than two points. A NaN anywhere in `points` propagates
 * rather than falling back to zero: no caller today can produce one, since
 * weightTrend's x is a day offset derived from a parsed date and its y is a
 * logged kg, so guarding it would be dead code answering a question nobody asks.
 */
export function linearSlope(points: { x: number; y: number }[]) {
	const n = points.length;
	// No separate n < 2 guard: with fewer than two points the deviations from
	// the mean are all zero, so `den` stays 0 and the fallback below already
	// answers 0 the same way a guard would.
	const meanX = points.reduce((s, p) => s + p.x, 0) / n;
	// meanY is centered into y below rather than folded away algebraically:
	// subtracting a constant from every y leaves the covariance sum unchanged
	// in exact arithmetic, but not in IEEE 754. Review measured the drop
	// shifting a displayed kcal figure by 1 for realistic profiles (up to
	// 7.4e-15 kg/day drift over 400k cases). Keeping meanY is the
	// numerically stable form of this sum.
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
	// weights arrives sorted ascending by date (adaptiveTdee sorts before
	// calling), so the last point's x is also the largest -- reading it via
	// reduce keeps weightSpanDays derived from the same points linearSlope
	// uses, instead of recomputing the last date's offset independently,
	// without adding an unreachable empty-points branch: reduce's own
	// initial value already answers 0 for the empty case the length guard
	// above rules out.
	const weightSpanDays = points.reduce((max, p) => Math.max(max, p.x), 0);
	return { kgPerDay: linearSlope(points), weightSpanDays };
}

export function adaptiveTdee(profile: Profile, end = todayISO()): AdaptiveTdee {
	const fallback = estimatedTdee(profile);
	const windowDays = 21;
	const dates = lastNDates(windowDays, end);
	const start = dates[0] ?? end;

	const grouped = byDate(profile.log);
	const logged = dates
		.map((d) => totalOf(grouped.get(d)))
		.filter((x): x is NonNullable<typeof x> => x !== null);

	const weights = profile.weights
		.filter((w) => w.date >= start && w.date <= end)
		.sort((a, b) => a.date.localeCompare(b.date));

	const avgIntake = logged.length > 0 ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;

	const { kgPerDay, weightSpanDays } = weightTrend(weights);

	// No separate weights.length >= 4 check: weightTrend only ever reports a
	// nonzero weightSpanDays when it had at least four weigh-ins to trend
	// (see its own guard above), so weightSpanDays >= 10 already implies it.
	const enough = logged.length >= 7 && weightSpanDays >= 10;

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
	return totalOf(log.filter((i) => i.date === date)) ?? emptyDay();
}

/**
 * Averages over the logged days only; an unlogged day is left out of the
 * divisor rather than counted as a zero.
 */
export function rollingAverages(log: LogItem[], days: number, end = todayISO()) {
	const dates = lastNDates(days, end);
	const grouped = byDate(log);
	const logged = dates
		.map((d) => totalOf(grouped.get(d)))
		.filter((x): x is DayNutrition => x !== null);
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

/** Milliseconds in a day, for turning two local midnights into a day count. */
const DAY_MS = 86400000;

/**
 * A Monday, used only as the origin week indices are counted from. 1970-01-05
 * is the first Monday of the epoch. Any Monday would do: the answer is a count
 * of weeks that clear a bar, so where the numbering starts cannot change it.
 */
const WEEK_EPOCH = '1970-01-05';

/**
 * Weeks (Mon–Sun) with at least `minDays` logged. Never resets on a miss.
 *
 * Each logged date is placed in its week by arithmetic, rather than each week
 * asking whether any of its seven dates was logged. The two count the same
 * thing — a date belongs to the week whose Monday is the last one at or before
 * it — but the old shape built seven ISO strings per week through
 * `addDaysISO`, so a three-year span paid for about eleven hundred date parses
 * and re-formats to look up dates a `Set` already held. This pays one parse per
 * *distinct logged date*, plus one for each end of the range, and formats
 * nothing. See `perf:route-render`: it was 79% of a `/progress` render.
 *
 * The weeks are still walked from the first logged one to the last, rather than
 * only the weeks something was logged in, because a week with nothing in it
 * clears a `minDays` of zero and has to be counted — `minDays` is a parameter,
 * and the empty weeks in between are part of the answer at the bottom of its
 * range.
 *
 * The cut-off is a whole week rather than the day `end` falls on, as it was
 * before: the old shape sized its weeks from `end` and then counted all seven
 * days of the last one. So a date later in the same week as `end` still counts
 * toward it — logging tomorrow's breakfast tonight does not vanish — while a
 * date in a later week is dropped.
 *
 * Every loop is bounded by a length fixed before it starts — the logged dates,
 * then the weeks they span — rather than walked by a mutable cursor. A
 * `while (cursor <= end)` loop hangs forever under a mutation that drops the
 * step, and this codebase's mutation ledger charges that timeout as debt even
 * though the runner scores a timeout as a kill. Fixed bounds mean every
 * mutation still terminates, failing fast on a wrong answer instead of hanging.
 *
 * No separate guard for a range that runs backwards (every logged date after
 * `end`), nor for an empty log: the length is then zero, negative or
 * `-Infinity`, and `Array.from` treats any of those as zero, so the walk simply
 * does not run and the answer is no calm weeks.
 */
export function calmWeeks(log: LogItem[], minDays = 4, end = todayISO()) {
	const dates = new Set(log.map((i) => i.date));
	const epochMs = parseISODate(WEEK_EPOCH).getTime();
	/** The week index a date falls in, counting from `WEEK_EPOCH`. */
	const weekOf = (iso: string) =>
		// `Math.round` before the division because a daylight-saving shift leaves
		// two local midnights an hour short of a whole number of days apart, and
		// that hour must not move a date into the week beside it.
		Math.floor(Math.round((parseISODate(iso).getTime() - epochMs) / DAY_MS) / 7);

	const lastWeek = weekOf(end);
	// `Infinity` rather than the first week seen, so the running minimum needs no
	// "have we started yet" branch. It is also what makes an empty log need no
	// guard of its own: nothing replaces it, the range below comes out
	// `-Infinity` long, and a negative length is an empty walk.
	let firstWeek = Infinity;
	const perWeek = new Map<number, number>();
	// Distinct dates: a day is several meals, and the bar is days logged, not
	// entries made. Deduping first also means one date parse per day rather
	// than one per entry.
	for (const date of dates) {
		const week = weekOf(date);
		firstWeek = Math.min(firstWeek, week);
		perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
	}

	let count = 0;
	for (const offset of Array.from({ length: lastWeek - firstWeek + 1 }, (_, w) => w)) {
		if ((perWeek.get(firstWeek + offset) ?? 0) >= minDays) count++;
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

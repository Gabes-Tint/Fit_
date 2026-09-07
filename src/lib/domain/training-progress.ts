import { weekOf, WEEKS_IN_YEAR, type CalendarWeek } from '$lib/domain/training-plan';
import { plannedSessionsBetween } from '$lib/domain/planned-days';
import type { LoadUnit, MuscleGroup, PlannedDay, Workout } from '$lib/domain/types';
import { round1 } from '$lib/domain/utils';
import { countsAsTraining, setsDone } from '$lib/domain/workout';

/** Only a finished workout counts as training done; an abandoned one is not evidence. */
function finished(workouts: Workout[]): Workout[] {
	return workouts.filter((w) => w.finishedAt !== null);
}

export type TrendPoint = {
	/** The training year the week belongs to, which is not always its calendar year. */
	year: number;
	week: number;
	/** "W34", the training week the top set was lifted in. */
	label: string;
	load: number;
};

/**
 * The heaviest set of one movement, week by week. Weeks are keyed by year and
 * number, not number alone, so week 52 and week 1 either side of New Year
 * stay in order.
 */
export function loadTrend(workouts: Workout[], name: string, count = 7): TrendPoint[] {
	const byWeek = new Map<string, TrendPoint>();
	for (const workout of finished(workouts)) {
		const sets = workout.exercises.find((e) => e.name === name)?.sets.filter((s) => s.done) ?? [];
		if (sets.length === 0) continue;
		const top = Math.max(...sets.map((s) => s.load));
		const { year, week } = weekOf(workout.date);
		const key = `${year}-${week}`;
		const load = Math.max(byWeek.get(key)?.load ?? 0, top);
		byWeek.set(key, { year, week, label: `W${week}`, load });
	}
	return [...byWeek.values()].sort((a, b) => a.year - b.year || a.week - b.week).slice(-count);
}

/**
 * How many weeks the trend spans, gaps included — the span between the first
 * and last point, not the number of points.
 */
export function weekSpan(points: TrendPoint[]): number {
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last) return 0;
	return (last.year - first.year) * WEEKS_IN_YEAR + (last.week - first.week) + 1;
}

/** The movements trained most often, so the trend has something worth charting. */
export function trainedExercises(workouts: Workout[]): string[] {
	const counts = new Map<string, number>();
	for (const workout of finished(workouts)) {
		for (const exercise of workout.exercises) {
			if (setsDone(exercise.sets) > 0) {
				counts.set(exercise.name, (counts.get(exercise.name) ?? 0) + 1);
			}
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([n]) => n);
}

export type GroupVolume = {
	group: MuscleGroup;
	sets: number;
	/** Share of the busiest group, which is what the bar next to it draws. */
	pct: number;
};

export function volumeByGroup(workouts: Workout[], sinceISO: string): GroupVolume[] {
	const counts = new Map<MuscleGroup, number>();
	for (const workout of finished(workouts)) {
		if (workout.date < sinceISO) continue;
		for (const exercise of workout.exercises) {
			const done = setsDone(exercise.sets);
			if (done > 0) counts.set(exercise.group, (counts.get(exercise.group) ?? 0) + done);
		}
	}
	const most = Math.max(0, ...counts.values());
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([group, sets]) => ({
			group,
			sets,
			pct: most === 0 ? 0 : Math.round((sets / most) * 100)
		}));
}

export type AdherenceWeek = {
	week: number;
	label: string;
	planned: number;
	done: number;
};

/**
 * What the plan asked for against what happened, for recent weeks. The
 * denominator is the sessions actually put on the week's days — a day holding a
 * lift and a run asks for two — so a week nobody planned asks for nothing, and
 * training through it shows as done with no shortfall to answer for.
 */
export function weeklyAdherence(args: {
	workouts: Workout[];
	plan: PlannedDay[];
	weeks: CalendarWeek[];
	throughWeek: number;
	count?: number;
}): AdherenceWeek[] {
	const { workouts, plan, weeks, throughWeek, count = 4 } = args;
	// A filed-but-empty session is not one the plan asked for; counting it would
	// let a week be met by walking in and out again.
	const trained = workouts.filter(countsAsTraining);
	return weeks
		.filter((w) => w.week <= throughWeek)
		.slice(-count)
		.map((w) => ({
			week: w.week,
			label: `Week ${w.week}`,
			planned: plannedSessionsBetween(plan, w.startISO, w.endISO),
			done: trained.filter((workout) => workout.date >= w.startISO && workout.date <= w.endISO)
				.length
		}));
}

export type PersonalRecord = {
	name: string;
	load: number;
	reps: number;
	date: string;
};

/** The heaviest completed set of each movement, heaviest movement first. */
export function personalRecords(workouts: Workout[], limit = 3): PersonalRecord[] {
	const best = new Map<string, PersonalRecord>();
	for (const workout of finished(workouts)) {
		for (const exercise of workout.exercises) {
			for (const set of exercise.sets) {
				if (!set.done || set.load === 0) continue;
				const current = best.get(exercise.name);
				if (!current || set.load > current.load) {
					best.set(exercise.name, {
						name: exercise.name,
						load: set.load,
						reps: set.reps,
						date: workout.date
					});
				}
			}
		}
	}
	return [...best.values()].sort((a, b) => b.load - a.load).slice(0, limit);
}

/**
 * How much the charted movement has moved, as a sentence. Empty when there is
 * nothing to report: one week has no change, and an unchanged top set is no news.
 */
function loadSentence(workouts: Workout[], unit: LoadUnit): string {
	// The movement the load trend opens on, so the note and its chart match.
	const name = trainedExercises(workouts)[0];
	if (name === undefined) return '';
	const points = loadTrend(workouts, name);
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last || first.load === last.load) return '';
	const change = round1(Math.abs(last.load - first.load));
	const direction = last.load > first.load ? 'heavier' : 'lighter';
	// One less than the span: it points at the week the first bar was lifted,
	// not the width of the chart.
	const ago = weekSpan(points) - 1;
	return `${name} is ${change} ${unit} ${direction} than ${ago} ${ago === 1 ? 'week' : 'weeks'} ago.`;
}

/**
 * Which group the plan is thinnest on, as a sentence. Empty until two groups
 * can be compared — one group is all there is, not the thin part.
 */
function thinGroupSentence(workouts: Workout[], sinceISO: string): string {
	const volume = volumeByGroup(workouts, sinceISO);
	const thinnest = volume.length > 1 ? volume.at(-1) : undefined;
	if (!thinnest) return '';
	// "Legs are", "Chest is": a group reads as plural exactly when it ends in s.
	const verb = thinnest.group.endsWith('s') ? 'are' : 'is';
	return `${thinnest.group} ${verb} still the thin part of the plan.`;
}

/**
 * The take-away under the session summary: how the charted movement has moved
 * and which group the plan is thinnest on. Each half is dropped when it has
 * nothing to say.
 */
export function summaryNote(args: {
	workouts: Workout[];
	unit: LoadUnit;
	/** The window the volume half looks over, as the volume card uses. */
	sinceISO: string;
}): string {
	return [loadSentence(args.workouts, args.unit), thinGroupSentence(args.workouts, args.sinceISO)]
		.filter((sentence) => sentence !== '')
		.join(' ');
}

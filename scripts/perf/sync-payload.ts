import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { buildAlexProfile, buildJordanProfile } from '../../src/lib/domain/demo-seed.ts';
import { ROUTINE_TEMPLATES } from '../../src/lib/domain/exercise-catalog.ts';
import { routinesFromTemplate } from '../../src/lib/domain/exercises.ts';
import { emptyProfile } from '../../src/lib/domain/profile.ts';
import {
	SCHEMA_VERSION,
	emptyState,
	stateFormat,
	storedDocument
} from '../../src/lib/domain/state-document.ts';
import { MAX_STATE_BODY_BYTES } from '../../src/lib/domain/state-size.ts';
import { buildWeekPlan } from '../../src/lib/domain/week-plan.ts';
import { workoutFromRoutine } from '../../src/lib/domain/workout.ts';
import { addDaysISO } from '../../src/lib/domain/utils.ts';
import type { LogItem, Profile, Routine, TendState, Workout } from '../../src/lib/domain/types.ts';

/**
 * The state-document sync lead from issue #130: how many bytes one `PUT
 * /api/state` carries, at the scales a real account reaches, and what a diff
 * or a compressed body would take off that.
 *
 * Every document below is built from fixtures already in the tree — the demo
 * seed's own journal (`demo-seed.ts`, what "Use sample data" installs) and the
 * first routine template (`exercise-catalog.ts`) — so the food, the macros and
 * the loads are the application's, not this file's invention. What this file
 * adds is the calendar: the demo seed is 21 days, and the question is what a
 * month, a year and three years look like, so its own day cycle is repeated
 * out to that many days.
 *
 * Deterministic on purpose. `demo-seed.ts` dates from `todayISO()` and
 * identifies entries with `uid()`, which reads the clock and `Math.random`, so
 * a compressed size taken straight off it would differ run to run and no
 * committed number could be compared against a later one. Both are normalized
 * here — a fixed anchor date, and ids numbered in order — which changes the
 * bytes not at all in the uncompressed columns (every id is the same length
 * either way) and makes the compressed ones repeatable.
 *
 * This module measures. It does not change how sync works, and nothing here is
 * imported by the application.
 */

/** The date every generated journal ends on, so a run in June and a run in December agree. */
export const ANCHOR_DATE = '2026-06-30';

/**
 * The ceiling the state endpoint refuses a body over, imported rather than
 * restated: the interesting figure this instrument reports is how long an
 * account takes to reach it, and a second copy of the number would report a
 * distance to a wall that is not there. It used to be a copy (#282).
 */
export { MAX_STATE_BODY_BYTES };

/** One measured document. */
export interface PayloadRow {
	label: string;
	days: number;
	logEntries: number;
	workouts: number;
	/** `JSON.stringify` of the stored document — what `localStorage` also holds. */
	documentBytes: number;
	/** What actually goes on the wire: the document inside the PUT envelope. */
	putBytes: number;
	gzipBytes: number;
	brotliBytes: number;
	/** Bytes the envelope grows by when one more log entry is recorded. */
	entryDeltaBytes: number;
}

export interface SyncPayloadReport {
	when: string;
	rows: PayloadRow[];
}

const encoder = new TextEncoder();

/** Pure: UTF-8 length, which is what a `content-length` counts. */
export function byteLength(text: string): number {
	return encoder.encode(text).length;
}

/**
 * Pure: the exact bytes `writeRemote` in `sync.svelte.ts` sends — the whole
 * document inside `{ version, format, body }`, never a part of it. The version
 * is a stand-in; it is two digits wide at every scale that matters and the
 * point of the row is the body.
 */
export function putEnvelope(state: TendState, version = 42): string {
	return JSON.stringify({
		version,
		format: stateFormat(SCHEMA_VERSION),
		body: storedDocument(state)
	});
}

/** Pure: the journal of the committed demo seed, grouped into its days, oldest first. */
export function seedDays(): LogItem[][] {
	const byDate = new Map<string, LogItem[]>();
	for (const entry of buildAlexProfile().log) {
		const day = byDate.get(entry.date);
		if (day) day.push(entry);
		else byDate.set(entry.date, [entry]);
	}
	return [...byDate.values()];
}

/**
 * Pure: the demo seed's own journal stretched to `days`, ending at the anchor.
 * Each entry keeps every field the fixture gave it — food, macros, micros,
 * serving, source — and takes a new date and a numbered id, so the size is the
 * application's own and the number is reproducible.
 */
export function scaledLog(days: number, cycle = seedDays()): LogItem[] {
	const log: LogItem[] = [];
	for (let ago = days - 1; ago >= 0; ago--) {
		const dayIndex = days - 1 - ago;
		const day = cycle[dayIndex % cycle.length] ?? [];
		const date = addDaysISO(ANCHOR_DATE, -ago);
		for (const [index, entry] of day.entries()) {
			log.push({
				...entry,
				date,
				id: `l-${String(dayIndex).padStart(5, '0')}-${String(index).padStart(2, '0')}`
			});
		}
	}
	return log;
}

/** Pure: a weigh-in every other day, the cadence the demo seed itself uses. */
export function scaledWeights(days: number): Profile['weights'] {
	const weights: Profile['weights'] = [];
	for (let ago = days - 1; ago >= 0; ago--) {
		if (ago % 2 !== 0) continue;
		weights.push({
			id: `w-${String(ago).padStart(5, '0')}`,
			date: addDaysISO(ANCHOR_DATE, -ago),
			kg: Math.round((78 - (days - 1 - ago) * 0.01) * 100) / 100
		});
	}
	return weights;
}

/**
 * Pure: the rotation onboarding offers first, deep-copied. An empty catalog
 * would give an account with no routines, which is a document this instrument
 * can still measure rather than a case it has to refuse.
 */
export function firstTemplateRoutines(): Routine[] {
	const template = ROUTINE_TEMPLATES[0];
	return template === undefined ? [] : routinesFromTemplate(template);
}

/** Pure: three finished sessions a week, from the first committed routine template. */
export function scaledWorkouts(days: number, routines: Routine[]): Workout[] {
	const workouts: Workout[] = [];
	for (let ago = days - 1; ago >= 0; ago--) {
		if (ago % 7 > 2) continue;
		const routine = routines[ago % routines.length];
		if (!routine) continue;
		const date = addDaysISO(ANCHOR_DATE, -ago);
		const startedAt = Date.parse(`${date}T18:00:00.000Z`);
		const started = workoutFromRoutine(routine, {
			id: `s-${String(ago).padStart(5, '0')}`,
			date,
			startedAt
		});
		// A session that happened, rather than one abandoned at the first set:
		// every set marked done, the last exercise reached, and an end time on it.
		workouts.push({
			...started,
			finishedAt: startedAt + 55 * 60 * 1000,
			exerciseIndex: Math.max(0, started.exercises.length - 1),
			exercises: started.exercises.map((exercise) => ({
				...exercise,
				sets: exercise.sets.map((set) => ({ ...set, done: true }))
			}))
		});
	}
	return workouts;
}

export interface ScaleOptions {
	days: number;
	/** Whether the account trains as well as eats. */
	training: boolean;
}

/** Pure: the whole `TendState` an account at this scale is holding. */
export function scaledState(options: ScaleOptions): TendState {
	const routines = firstTemplateRoutines();
	const profile: Profile = {
		...emptyProfile({ name: 'Alex' }),
		id: 'p-alex',
		goal: 'lose',
		sex: 'female',
		age: 34,
		heightCm: 168,
		activity: 'light',
		log: scaledLog(options.days),
		weights: scaledWeights(options.days)
	};
	const workouts = options.training ? scaledWorkouts(options.days, routines) : [];
	return {
		...emptyState(),
		onboarded: true,
		activeProfileId: profile.id,
		profiles: [profile],
		routines,
		weekPlan: buildWeekPlan({ profiles: [profile], today: ANCHOR_DATE }),
		workouts,
		trainingPlan: workouts.map((workout) => ({
			date: workout.date,
			routineIds: [workout.routineId]
		}))
	};
}

/**
 * Pure: the household the demo seed actually installs — Alex's 21 days and
 * Jordan's 11 — normalized the same way, which is the only row here whose data
 * is a fixture end to end rather than a fixture repeated.
 */
export function demoSeedState(): TendState {
	const routines = firstTemplateRoutines();
	const normalize = (profile: Profile, id: string): Profile => ({
		...profile,
		id,
		log: profile.log.map((entry, index) => ({
			...entry,
			id: `l-${id}-${String(index).padStart(4, '0')}`
		})),
		weights: profile.weights.map((weight, index) => ({
			...weight,
			id: `w-${id}-${String(index).padStart(4, '0')}`
		}))
	});
	const alex = normalize(buildAlexProfile(), 'alex');
	const jordan = normalize(buildJordanProfile(), 'jordan');
	return {
		...emptyState(),
		onboarded: true,
		activeProfileId: alex.id,
		profiles: [alex, jordan],
		routines,
		weekPlan: buildWeekPlan({ profiles: [alex, jordan], today: ANCHOR_DATE })
	};
}

/** Pure: the state a device holds the moment onboarding finishes, with no journal at all. */
export function newAccountState(): TendState {
	const routines = firstTemplateRoutines();
	const profile = { ...emptyProfile({ name: 'Alex' }), id: 'p-alex' };
	return {
		...emptyState(),
		onboarded: true,
		activeProfileId: profile.id,
		profiles: [profile],
		routines,
		weekPlan: buildWeekPlan({ profiles: [profile], today: ANCHOR_DATE })
	};
}

/** Pure: the same state with one more log entry, which is what one meal records. */
export function withOneMoreEntry(state: TendState): TendState {
	const profile = state.profiles[0];
	if (!profile) return state;
	const template = profile.log[profile.log.length - 1] ?? seedDays()[0]?.[0];
	if (!template) return state;
	const added: LogItem = { ...template, id: 'l-99999-99', date: ANCHOR_DATE };
	return {
		...state,
		profiles: [{ ...profile, log: [...profile.log, added] }, ...state.profiles.slice(1)]
	};
}

/** Pure: one measured row. Compression levels are the ones a proxy would use, not the maxima. */
export function measureState(label: string, days: number, state: TendState): PayloadRow {
	const wire = putEnvelope(state);
	const buffer = Buffer.from(wire, 'utf8');
	return {
		label,
		days,
		logEntries: state.profiles.reduce((total, profile) => total + profile.log.length, 0),
		workouts: state.workouts.length,
		documentBytes: byteLength(JSON.stringify(storedDocument(state))),
		putBytes: byteLength(wire),
		gzipBytes: gzipSync(buffer, { level: 6 }).length,
		brotliBytes: brotliCompressSync(buffer, {
			params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
		}).length,
		entryDeltaBytes: byteLength(putEnvelope(withOneMoreEntry(state))) - byteLength(wire)
	};
}

/** The scales this instrument reports, smallest first. */
export function payloadRows(): PayloadRow[] {
	return [
		measureState('empty device', 0, emptyState()),
		measureState('new account, no journal', 0, newAccountState()),
		measureState('demo seed (21 d + 11 d, two profiles)', 21, demoSeedState()),
		measureState('30 days, food only', 30, scaledState({ days: 30, training: false })),
		measureState('30 days, food + training', 30, scaledState({ days: 30, training: true })),
		measureState('365 days, food only', 365, scaledState({ days: 365, training: false })),
		measureState('365 days, food + training', 365, scaledState({ days: 365, training: true })),
		measureState('1095 days, food + training', 1095, scaledState({ days: 1095, training: true }))
	];
}

/**
 * Pure: how many days of this row's growth fit under the server's ceiling.
 * `Infinity` for a row that is not growing, so a caller reporting it has one
 * shape to handle rather than a null.
 */
export function daysToCeiling(row: PayloadRow, ceiling = MAX_STATE_BODY_BYTES): number {
	if (row.days <= 0 || row.putBytes <= 0) return Infinity;
	const perDay = row.putBytes / row.days;
	return perDay <= 0 ? Infinity : Math.floor(ceiling / perDay);
}

/**
 * Pure: how many bytes leave the phone for every byte that actually changed —
 * the whole case for sending a diff instead of the document, in one number.
 * `null` for a row nothing was added to, which is not an amplification of
 * zero but an absence of one.
 */
export function amplification(row: PayloadRow): number | null {
	if (row.entryDeltaBytes <= 0) return null;
	return Math.round(row.putBytes / row.entryDeltaBytes);
}

/** Pure: a percentage to one decimal, for the share-of-document columns. */
export function percent(part: number, whole: number): string {
	return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

function kilobytes(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Pure: the markdown table and the derived figures under it. Takes the rows
 * rather than the report, so the committed baseline carries no timestamp and a
 * rerun that measured the same thing produces a byte-identical file.
 */
export function formatSyncPayload(rows: PayloadRow[]): string {
	const worst = rows[rows.length - 1];
	const year = rows.find((row) => row.days === 365 && row.workouts > 0);
	return [
		'# Sync payload size',
		'',
		'Written by `bun run perf:sync-payload`; the run’s timestamp is in',
		'`reports/perf/sync-payload.json` rather than here, so this file only changes',
		'when a number does.',
		'',
		'One `PUT /api/state` carries the whole state document; `sync.svelte.ts` sends',
		'`storedDocument(state)` in full on every change. These are the bytes it carries.',
		'',
		'`Sent per byte changed` is the PUT body divided by what one more logged entry adds:',
		'the amplification a diff would remove.',
		'',
		'| Scale | Log entries | Workouts | Document | PUT body | gzip | brotli | gzip share | One more entry | Sent per byte changed |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...rows.map((row) =>
			[
				'',
				row.label,
				String(row.logEntries),
				String(row.workouts),
				kilobytes(row.documentBytes),
				kilobytes(row.putBytes),
				kilobytes(row.gzipBytes),
				kilobytes(row.brotliBytes),
				percent(row.gzipBytes, row.putBytes),
				`${row.entryDeltaBytes} B`,
				amplification(row) === null ? '—' : `${amplification(row)}×`,
				''
			]
				.join(' | ')
				.trim()
		),
		'',
		`Server ceiling: ${MAX_STATE_BODY_BYTES} bytes (\`MAX_STATE_BODY_BYTES\`, \`src/lib/domain/state-size.ts\`).`,
		year === undefined
			? 'No one-year row was measured.'
			: `A year of food and training is ${kilobytes(year.putBytes)} per push, and reaches that ceiling after about ${daysToCeiling(year)} days.`,
		worst === undefined
			? ''
			: `Largest row measured: ${worst.label}, ${kilobytes(worst.putBytes)}, ${percent(worst.putBytes, MAX_STATE_BODY_BYTES)} of the ceiling.`,
		''
	].join('\n');
}

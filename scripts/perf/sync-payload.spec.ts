import { describe, expect, it } from 'vitest';
import {
	ANCHOR_DATE,
	MAX_STATE_BODY_BYTES,
	amplification,
	byteLength,
	daysToCeiling,
	demoSeedState,
	firstTemplateRoutines,
	formatSyncPayload,
	measureState,
	newAccountState,
	payloadRows,
	percent,
	putEnvelope,
	scaledLog,
	scaledState,
	scaledWeights,
	scaledWorkouts,
	seedDays,
	withOneMoreEntry
} from './sync-payload.ts';
import type { PayloadRow } from './sync-payload.ts';
import { emptyState } from '../../src/lib/domain/state-document.ts';
import type { LogItem, Profile, TendState } from '../../src/lib/domain/types.ts';

function row(overrides: Partial<PayloadRow> = {}): PayloadRow {
	return {
		label: 'row',
		days: 365,
		logEntries: 10,
		workouts: 0,
		documentBytes: 1000,
		putBytes: 1024,
		gzipBytes: 256,
		brotliBytes: 128,
		entryDeltaBytes: 400,
		...overrides
	};
}

/** The one profile every generated document has, named rather than indexed at each use. */
function onlyProfile(state: TendState): Profile {
	const [profile] = state.profiles;
	if (profile === undefined) throw new Error('the state under test has no profile');
	return profile;
}

function firstDay(): LogItem[] {
	const [day] = seedDays();
	if (day === undefined) throw new Error('the demo seed has no journal');
	return day;
}

function yearRow(rows: PayloadRow[]): PayloadRow {
	const year = rows.find((candidate) => candidate.days === 365 && candidate.workouts > 0);
	if (year === undefined) throw new Error('no one-year training row was measured');
	return year;
}

function last<T>(items: T[]): T {
	const item = items[items.length - 1];
	if (item === undefined) throw new Error('empty');
	return item;
}

describe('byteLength', () => {
	it('counts UTF-8 bytes rather than characters, which is what a content-length carries', () => {
		expect(byteLength('é')).toBe(2);
	});
});

describe('putEnvelope', () => {
	it('carries the whole document, not a part of it', () => {
		const state = scaledState({ days: 3, training: false });
		const envelope = JSON.parse(putEnvelope(state)) as { body: { profiles: { log: unknown[] }[] } };

		expect(envelope.body.profiles[0]?.log).toHaveLength(onlyProfile(state).log.length);
	});

	it('stamps the schema version the client would send', () => {
		const envelope = JSON.parse(putEnvelope(emptyState())) as { format: string; version: number };

		expect(envelope.format).toMatch(/^tend\.v\d+$/);
		expect(envelope.version).toBe(42);
	});
});

describe('the generated journal', () => {
	it('repeats the demo seed’s own days rather than inventing food', () => {
		const day = firstDay();
		const log = scaledLog(seedDays().length * 2);

		expect(log.slice(0, day.length).map((entry) => entry.name)).toEqual(
			day.map((entry) => entry.name)
		);
	});

	it('ends on the anchor date, so two runs on different days agree', () => {
		expect(last(scaledLog(10)).date).toBe(ANCHOR_DATE);
	});

	it('gives every entry its own id, so nothing is deduplicated by accident', () => {
		const log = scaledLog(40);

		expect(new Set(log.map((entry) => entry.id)).size).toBe(log.length);
	});

	it('grows the log in proportion to the days asked for', () => {
		expect(scaledLog(60).length).toBeGreaterThan(scaledLog(30).length * 1.5);
	});

	it('records a weigh-in every other day', () => {
		expect(scaledWeights(10)).toHaveLength(5);
	});

	it('records three finished sessions a week', () => {
		const workouts = scaledWorkouts(14, firstTemplateRoutines());

		expect(workouts).toHaveLength(6);
		expect(workouts.every((workout) => workout.finishedAt !== null)).toBe(true);
		expect(
			workouts.every((workout) => workout.exercises.every((e) => e.sets.every((s) => s.done)))
		).toBe(true);
	});

	it('records nothing at all when there is no routine to record it from', () => {
		expect(scaledWorkouts(14, [])).toEqual([]);
	});

	it('offers the first committed template, deep-copied', () => {
		const [first, second] = [firstTemplateRoutines(), firstTemplateRoutines()];

		expect(first.length).toBeGreaterThan(0);
		expect(first).toEqual(second);
		expect(first[0]).not.toBe(second[0]);
	});

	it('leaves training out when the account only eats', () => {
		const state = scaledState({ days: 30, training: false });

		expect(state.workouts).toEqual([]);
		expect(state.trainingPlan).toEqual([]);
	});

	it('plans a day for every session it records', () => {
		const state = scaledState({ days: 30, training: true });

		expect(state.trainingPlan).toHaveLength(state.workouts.length);
		expect(state.workouts.length).toBeGreaterThan(0);
	});
});

describe('measureState', () => {
	it('is repeatable: the same scale measures the same bytes twice', () => {
		const first = measureState('a', 30, scaledState({ days: 30, training: true }));
		const second = measureState('a', 30, scaledState({ days: 30, training: true }));

		expect(second).toEqual(first);
	});

	it('reports the wire body as larger than the document it wraps', () => {
		const measured = measureState('a', 30, scaledState({ days: 30, training: false }));

		expect(measured.putBytes).toBeGreaterThan(measured.documentBytes);
	});

	it('reports one more entry as a small fraction of a year’s document', () => {
		const measured = measureState('a', 365, scaledState({ days: 365, training: true }));

		expect(measured.entryDeltaBytes).toBeGreaterThan(0);
		expect(measured.entryDeltaBytes / measured.putBytes).toBeLessThan(0.001);
	});

	it('compresses far better than it does at a new account’s size', () => {
		const small = measureState('a', 0, newAccountState());
		const large = measureState('b', 365, scaledState({ days: 365, training: true }));

		expect(large.gzipBytes / large.putBytes).toBeLessThan(small.gzipBytes / small.putBytes);
	});

	it('counts every profile’s entries, not just the first', () => {
		const state = demoSeedState();
		const total = state.profiles.reduce((sum, profile) => sum + profile.log.length, 0);

		expect(measureState('seed', 21, state).logEntries).toBe(total);
		expect(state.profiles).toHaveLength(2);
	});
});

describe('withOneMoreEntry', () => {
	it('adds exactly one entry', () => {
		const state = scaledState({ days: 30, training: false });

		expect(onlyProfile(withOneMoreEntry(state)).log).toHaveLength(
			onlyProfile(state).log.length + 1
		);
	});

	it('leaves a document with no profile alone rather than inventing one', () => {
		expect(withOneMoreEntry(emptyState()).profiles).toEqual([]);
	});
});

describe('daysToCeiling', () => {
	it('divides the ceiling by what one day costs', () => {
		expect(daysToCeiling(row({ days: 100, putBytes: 1000 }), 10_000)).toBe(1000);
	});

	it('is unbounded for a document that is not growing', () => {
		expect(daysToCeiling(row({ days: 0 }))).toBe(Infinity);
		expect(daysToCeiling(row({ putBytes: 0 }))).toBe(Infinity);
	});
});

describe('amplification', () => {
	it('says how many bytes are sent for every byte that changed', () => {
		expect(amplification(row({ putBytes: 4000, entryDeltaBytes: 400 }))).toBe(10);
	});

	it('reports no amplification for a row nothing was added to', () => {
		expect(amplification(row({ entryDeltaBytes: 0 }))).toBeNull();
	});

	it('is in the thousands once a year has been logged', () => {
		expect(amplification(yearRow(payloadRows()))).toBeGreaterThan(1000);
	});
});

describe('percent', () => {
	it('reads as a percentage to one decimal', () => {
		expect(percent(1, 8)).toBe('12.5%');
	});

	it('says nothing rather than dividing by zero', () => {
		expect(percent(1, 0)).toBe('—');
	});
});

describe('the report', () => {
	it('measures every scale, smallest first', () => {
		const rows = payloadRows();

		expect(rows.length).toBeGreaterThan(4);
		const sizes = rows.map((measured) => measured.putBytes);

		expect(sizes).toEqual([...sizes].sort((left, right) => left - right));
		expect(new Set(sizes).size).toBe(sizes.length);
	});

	it('gives every row its amplification, and a dash where there is none', () => {
		const markdown = formatSyncPayload(payloadRows());

		expect(markdown).toContain('Sent per byte changed');
		expect(markdown).toContain('—');
	});

	it('names the server ceiling it is measured against', () => {
		const markdown = formatSyncPayload(payloadRows());

		expect(markdown).toContain(String(MAX_STATE_BODY_BYTES));
		expect(markdown).toContain('perf:sync-payload');
	});

	it('says how long a year-scale account has before it hits the ceiling', () => {
		const rows = payloadRows();

		expect(formatSyncPayload(rows)).toContain(String(daysToCeiling(yearRow(rows))));
	});

	it('says so rather than lying when no one-year row was measured', () => {
		expect(formatSyncPayload([row({ days: 30 })])).toContain('No one-year row was measured');
	});

	it('says nothing about a largest row when there are none at all', () => {
		expect(formatSyncPayload([])).toContain('No one-year row was measured');
	});

	it('starts a new account well under the ceiling', () => {
		expect(measureState('new', 0, newAccountState()).putBytes).toBeLessThan(
			MAX_STATE_BODY_BYTES / 100
		);
	});
});

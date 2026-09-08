import { describe, expect, it } from 'vitest';
import {
	documentIsFromTheFuture,
	emptyState,
	loadStateDocument,
	MIGRATIONS,
	parseStateDocument,
	isStateFormat,
	SCHEMA_VERSION,
	stateFormat,
	storedDocument
} from './state-document';
import { DEFAULT_LOAD_UNIT, DEFAULT_REST_SECONDS, DEFAULT_UNITS } from './types';
import { displayLoad } from './units';

/**
 * A blank document, written out rather than taken from `emptyState()`: a default
 * asserted against the function that produced it proves nothing about either.
 * The three settings come from `types.ts`, which is where they are decided.
 */
const BLANK = {
	onboarded: false,
	activeProfileId: '',
	profiles: [],
	weekPlan: [],
	pantry: [],
	routines: [],
	trainingPlan: [],
	workouts: [],
	activeWorkout: null,
	loadUnit: DEFAULT_LOAD_UNIT,
	restSeconds: DEFAULT_REST_SECONDS,
	units: DEFAULT_UNITS
};

/**
 * A household's document exactly as the build before this ladder wrote it:
 * every field the app had, no `schemaVersion`, and real content in all of it —
 * two weigh-ins, an injection, a logged breakfast, a finished workout with the
 * set that was missed. This is the fixture the "no data loss" claim rests on,
 * so it is written out rather than generated: a builder that changes would move
 * the fixture with it, and then it would be proving nothing.
 */
const STORED_BEFORE_THE_LADDER = {
	onboarded: true,
	activeProfileId: 'p-alex',
	profiles: [
		{
			id: 'p-alex',
			name: 'Alex',
			sex: 'female',
			age: 32,
			heightCm: 168,
			activity: 'light',
			goal: 'lose',
			glp1: true,
			calorieOverride: 1800,
			proteinOverride: null,
			fiberOverride: null,
			restrictions: ['dairy'],
			weights: [
				{ id: 'wt-1', date: '2026-08-01', kg: 74.2 },
				{ id: 'wt-2', date: '2026-09-01', kg: 71.8 }
			],
			injections: [
				{
					id: 'inj-1',
					date: '2026-08-15',
					medication: 'semaglutide',
					doseMg: 0.5,
					site: 'abdomen',
					appetite: 2
				}
			],
			log: [
				{
					id: 'log-1',
					date: '2026-09-06',
					meal: 'breakfast',
					foodId: 'egg-large',
					name: 'Egg, large',
					servings: 3,
					kcal: 216,
					protein: 18.9,
					carbs: 1.1,
					fat: 14.4,
					micros: { fiber: 0 },
					source: 'manual'
				}
			]
		}
	],
	weekPlan: [
		{ date: '2026-09-07', meal: 'dinner', recipeId: 'chicken-rice', forProfileIds: ['p-alex'] }
	],
	pantry: ['oats', 'egg-large'],
	routines: [
		{
			id: 'r-1',
			name: 'Upper A',
			freq: 2,
			exercises: [{ id: 'ex-1', name: 'Bench press', group: 'chest', sets: 3, reps: 8, load: 45 }]
		}
	],
	trainingPlan: [{ year: 2026, week: 36, routineId: 'r-1' }],
	workouts: [
		{
			id: 'wo-9',
			routineId: 'r-1',
			routineName: 'Upper A',
			date: '2026-09-05',
			startedAt: 1757000000000,
			finishedAt: 1757003600000,
			exerciseIndex: 0,
			exercises: [
				{
					name: 'Bench press',
					group: 'chest',
					note: 'felt strong',
					sets: [
						{ reps: 8, load: 45, done: true },
						{ reps: 8, load: 45, done: true },
						{ reps: 6, load: 45, done: false }
					]
				}
			]
		}
	],
	activeWorkout: null,
	loadUnit: 'lb',
	restSeconds: 120,
	units: 'imperial'
};

/**
 * 45 lb as the mass it is. The household read its loads in pounds, so version 4
 * writes every one of them in kilograms; the number is written out rather than
 * converted here, since a fixture that ran the same arithmetic as the rung would
 * agree with it whatever either of them did.
 */
const BENCH_KG = 20.41165665;

/**
 * The same household once the whole ladder has run. Four rungs changed it: the
 * routine lost the `freq` that used to decide its days and gained the flag that
 * says it has not been deleted, the single week it had planned became the two
 * dated days version 1 drew for a twice-a-week routine — Monday 7 and Thursday
 * 10 September, the Monday and Thursday of training week 36 of 2026 — and every
 * load became kilograms. Everything else is untouched, which is the claim this
 * fixture exists to hold the ladder to.
 */
const AFTER_THE_LADDER = {
	...STORED_BEFORE_THE_LADDER,
	routines: [
		{
			id: 'r-1',
			name: 'Upper A',
			exercises: [
				{ id: 'ex-1', name: 'Bench press', group: 'chest', sets: 3, reps: 8, load: BENCH_KG }
			],
			deletedAt: null
		}
	],
	trainingPlan: [
		{ date: '2026-09-07', routineIds: ['r-1'] },
		{ date: '2026-09-10', routineIds: ['r-1'] }
	],
	workouts: [
		{
			id: 'wo-9',
			routineId: 'r-1',
			routineName: 'Upper A',
			date: '2026-09-05',
			startedAt: 1757000000000,
			finishedAt: 1757003600000,
			exerciseIndex: 0,
			exercises: [
				{
					name: 'Bench press',
					group: 'chest',
					note: 'felt strong',
					sets: [
						{ reps: 8, load: BENCH_KG, done: true },
						{ reps: 8, load: BENCH_KG, done: true },
						{ reps: 6, load: BENCH_KG, done: false }
					]
				}
			]
		}
	]
};

/** The same content, as this build stores it. */
function atCurrentVersion(): Record<string, unknown> {
	return { ...AFTER_THE_LADDER, schemaVersion: SCHEMA_VERSION };
}

function loaded(document: unknown) {
	const result = loadStateDocument(document);
	if (!result.ok) throw new Error(`expected a document, got ${result.reason}: ${result.message}`);
	return result;
}

describe('a document stored before the ladder existed', () => {
	it('comes forward carrying every field it had, and nothing else', () => {
		const result = loaded(STORED_BEFORE_THE_LADDER);

		expect(result.migrated).toBe(true);
		// The whole document, field for field: nothing defaulted away, and the two
		// fields the ladder reshapes carrying the same training they always did.
		expect(result.state).toEqual(AFTER_THE_LADDER);
	});
});

describe('a document that declares a version', () => {
	// Version 1 is the lowest a document can declare, and the ladder has to start
	// from it rather than refuse it: rung 0 is for documents that declare nothing.
	it('climbs from the version it names, not from the bottom of the ladder', () => {
		const result = loaded({ ...STORED_BEFORE_THE_LADDER, schemaVersion: 1 });

		expect(result.migrated).toBe(true);
		expect(result.state).toEqual(AFTER_THE_LADDER);
	});
});

describe('what a migrated document still holds', () => {
	// Called inside each test, never while the file is being collected: a spec
	// that throws during collection runs no tests at all, and a run with no tests
	// proves nothing.
	const state = () => loaded(STORED_BEFORE_THE_LADDER).state;

	it('keeps the profile, its weigh-ins and its injections', () => {
		expect(state().profiles).toEqual(STORED_BEFORE_THE_LADDER.profiles);
		expect(state().profiles[0]?.weights.map((entry) => entry.kg)).toEqual([74.2, 71.8]);
		expect(state().profiles[0]?.injections).toHaveLength(1);
		expect(state().activeProfileId).toBe('p-alex');
	});

	it('keeps every meal that was logged', () => {
		expect(state().profiles[0]?.log).toEqual(STORED_BEFORE_THE_LADDER.profiles[0]?.log);
	});

	it('keeps the routine, minus the frequency that no longer describes it', () => {
		expect(state().routines).toEqual(AFTER_THE_LADDER.routines);
		expect(state().routines[0]).not.toHaveProperty('freq');
		expect(state().routines[0]?.exercises).toHaveLength(1);
	});

	// A routine that survived the ladder is one nobody deleted: version 2 had no
	// way to say otherwise, so the flag it arrives with has to say it is in the
	// rotation rather than leaving the question open.
	it('brings the routine up still in the rotation', () => {
		expect(state().routines[0]?.deletedAt).toBeNull();
	});

	// The point of the rung, asserted by content: the week that said "Upper A,
	// twice" becomes the two dates the app already showed for it, so a person
	// opening the planner after the upgrade sees the week they saw before it.
	it('turns the week it had planned into the days it was already drawing', () => {
		expect(state().trainingPlan).toEqual([
			{ date: '2026-09-07', routineIds: ['r-1'] },
			{ date: '2026-09-10', routineIds: ['r-1'] }
		]);
	});

	it('keeps the workouts, down to the set that was not finished', () => {
		expect(state().workouts).toEqual(AFTER_THE_LADDER.workouts);
		expect(state().workouts[0]?.exercises[0]?.sets[2]?.done).toBe(false);
		expect(state().workouts[0]?.exercises[0]?.note).toBe('felt strong');
	});

	// The household read in pounds, so its numbers were pounds; version 4 stores
	// the mass and converts for reading, which is why the bench still reads 45 lb
	// while a switch to kilograms now says 20.4 rather than repeating 45.
	it('carries the loads up as the masses they were, in the plan and in the log', () => {
		expect(state().routines[0]?.exercises[0]?.load).toBe(BENCH_KG);
		expect(state().workouts[0]?.exercises[0]?.sets[0]?.load).toBe(BENCH_KG);
		expect(displayLoad(BENCH_KG, 'lb')).toBe(45);
		expect(displayLoad(BENCH_KG, 'kg')).toBe(20.4);
	});

	it('keeps the week plan, the pantry and the settings', () => {
		expect(state().weekPlan).toEqual(STORED_BEFORE_THE_LADDER.weekPlan);
		expect(state().pantry).toEqual(['oats', 'egg-large']);
		expect(state().loadUnit).toBe('lb');
		expect(state().restSeconds).toBe(120);
		expect(state().units).toBe('imperial');
		expect(state().onboarded).toBe(true);
	});

	it('is a state and not a document: the version stays in storage', () => {
		expect(Object.keys(state()).sort()).toEqual(Object.keys(BLANK).sort());
	});
});

describe('the tolerance the first rung is allowed', () => {
	it('gives a field the old build never wrote its default', () => {
		const result = loaded({ onboarded: true });

		expect(result.state).toEqual({ ...BLANK, onboarded: true });
	});

	it('drops a field no build in this ladder knows, rather than carrying it', () => {
		const result = loaded({ ...STORED_BEFORE_THE_LADDER, mysteryField: 'left over' });

		expect(Object.keys(result.state)).not.toContain('mysteryField');
	});

	it('ends there: a versioned document is taken as it is or not at all', () => {
		const incomplete = atCurrentVersion();
		delete incomplete['restSeconds'];

		expect(loadStateDocument(incomplete)).toMatchObject({ ok: false, reason: 'invalid' });
	});
});

describe('a document from a newer build', () => {
	it('is refused rather than read', () => {
		const result = loadStateDocument({ ...atCurrentVersion(), schemaVersion: SCHEMA_VERSION + 1 });

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ reason: 'future' });
	});

	it('says so in words somebody can act on', () => {
		const result = loadStateDocument({ schemaVersion: SCHEMA_VERSION + 1 });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/update the app/i);
	});

	it('is refused however far ahead it is', () => {
		expect(documentIsFromTheFuture({ schemaVersion: SCHEMA_VERSION + 1 })).toBe(true);
		expect(documentIsFromTheFuture({ schemaVersion: 99 })).toBe(true);
	});

	it('is not confused with one this build wrote, or with one that predates the ladder', () => {
		expect(documentIsFromTheFuture(atCurrentVersion())).toBe(false);
		expect(documentIsFromTheFuture(STORED_BEFORE_THE_LADDER)).toBe(false);
		expect(documentIsFromTheFuture('not a document')).toBe(false);
		expect(documentIsFromTheFuture(null)).toBe(false);
	});
});

describe('a document that is not one', () => {
	it.each([null, 'text', 42, [], undefined])('is refused rather than completed: %s', (value) => {
		expect(loadStateDocument(value)).toMatchObject({ ok: false, reason: 'malformed' });
	});

	it.each([0, -1, 1.5, '1', null])('names no version this build can read: %s', (schemaVersion) => {
		expect(loadStateDocument({ ...atCurrentVersion(), schemaVersion })).toMatchObject({
			ok: false,
			reason: 'malformed'
		});
	});

	it.each([
		['onboarded', 'yes'],
		['onboarded', 1],
		['onboarded', null],
		['activeProfileId', 7],
		['activeProfileId', null],
		['profiles', 'Alex'],
		['profiles', {}],
		['weekPlan', null],
		['pantry', 'oats'],
		['routines', {}],
		['trainingPlan', 3],
		['workouts', 'none']
	])('is refused when %s is the wrong kind of thing: %s', (field, value) => {
		const wrong = { ...atCurrentVersion(), [field]: value };

		expect(loadStateDocument(wrong)).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('says what went wrong in words, rather than only a code', () => {
		const result = loadStateDocument('not a document');

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/could not be read/i);
		expect(result.message).toMatch(/nothing was loaded or changed/i);
	});

	it.each(['kilograms', '', null])('is refused when the load unit is not one: %s', (loadUnit) => {
		expect(loadStateDocument({ ...atCurrentVersion(), loadUnit })).toMatchObject({
			ok: false,
			reason: 'invalid'
		});
	});

	it.each(['stones', 'METRIC', 7])('is refused when the unit system is not one: %s', (units) => {
		expect(loadStateDocument({ ...atCurrentVersion(), units })).toMatchObject({
			ok: false,
			reason: 'invalid'
		});
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, '90', null])(
		'is refused when the rest length is not a number: %s',
		(restSeconds) => {
			expect(loadStateDocument({ ...atCurrentVersion(), restSeconds })).toMatchObject({
				ok: false,
				reason: 'invalid'
			});
		}
	);

	it('is refused when it carries a field this build does not know', () => {
		const result = loadStateDocument({ ...atCurrentVersion(), perDayRoutine: {} });

		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		if (result.ok) return;
		expect(result.message).toContain('perDayRoutine');
	});

	it('names the field it refused over', () => {
		const result = loadStateDocument({ ...atCurrentVersion(), workouts: null });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('workouts');
	});

	it('takes an active workout as an object or as nothing, and nothing else', () => {
		expect(loadStateDocument({ ...atCurrentVersion(), activeWorkout: {} }).ok).toBe(true);
		expect(loadStateDocument({ ...atCurrentVersion(), activeWorkout: null }).ok).toBe(true);
		expect(loadStateDocument({ ...atCurrentVersion(), activeWorkout: [] }).ok).toBe(false);
	});
});

describe('the ladder itself', () => {
	it('has a rung for every version below this one, and no more', () => {
		expect(MIGRATIONS).toHaveLength(SCHEMA_VERSION);
	});

	it('runs pure: the same input twice gives the same output', () => {
		const first = MIGRATIONS[0]?.(STORED_BEFORE_THE_LADDER);
		const second = MIGRATIONS[0]?.(STORED_BEFORE_THE_LADDER);

		expect(first).toEqual(second);
		expect(first).not.toBe(second);
	});

	// Determinism above says the same input gives the same output; this says a
	// rung applied to its own result changes nothing further, which is what makes
	// a half-finished upgrade safe to run again.
	it('runs idempotent: a rung applied to its own output changes nothing', () => {
		const once = MIGRATIONS[0]?.(STORED_BEFORE_THE_LADDER) as Record<string, unknown>;
		const twice = MIGRATIONS[0]?.(once);

		expect(twice).toEqual(once);
	});

	it('runs pure: the document it was handed is not touched', () => {
		const before = JSON.stringify(STORED_BEFORE_THE_LADDER);

		MIGRATIONS[0]?.(STORED_BEFORE_THE_LADDER);

		expect(JSON.stringify(STORED_BEFORE_THE_LADDER)).toBe(before);
	});

	it('loads pure: the same stored text twice gives the same state', () => {
		const raw = JSON.stringify(STORED_BEFORE_THE_LADDER);

		expect(parseStateDocument(raw)).toEqual(parseStateDocument(raw));
	});

	it('stamps the version it upgraded to', () => {
		expect(MIGRATIONS[0]?.({})?.['schemaVersion']).toBe(1);
	});
});

describe('the round trip', () => {
	it('preserves the version through storage', () => {
		const document = storedDocument(emptyState());
		const back = loaded(JSON.parse(JSON.stringify(document)) as unknown);

		expect(document.schemaVersion).toBe(SCHEMA_VERSION);
		expect(back.migrated).toBe(false);
		expect(back.state).toEqual(BLANK);
	});

	it('preserves every field of a document with something in it', () => {
		const state = loaded(STORED_BEFORE_THE_LADDER).state;
		const back = loaded(JSON.parse(JSON.stringify(storedDocument(state))) as unknown);

		expect(back.state).toEqual(state);
	});

	it('leaves the state itself unstamped, so the version has one home', () => {
		expect(Object.keys(emptyState())).not.toContain('schemaVersion');
	});
});

describe('a blank document', () => {
	it('is what a device with nothing on it holds', () => {
		expect(emptyState()).toEqual(BLANK);
	});

	it('is stamped with this build’s version when it is stored', () => {
		expect(storedDocument(emptyState())).toEqual({ ...BLANK, schemaVersion: SCHEMA_VERSION });
	});

	it('is what an empty document upgrades into', () => {
		expect(loaded({}).state).toEqual(BLANK);
	});
});

describe('the format label', () => {
	it('names this build’s schema version', () => {
		expect(stateFormat(SCHEMA_VERSION)).toBe(`tend.v${SCHEMA_VERSION}`);
		expect(isStateFormat(stateFormat(SCHEMA_VERSION))).toBe(true);
	});

	it('accepts a version this build has never heard of, rather than refusing it', () => {
		expect(isStateFormat('tend.v7')).toBe(true);
		expect(isStateFormat('tend.v42')).toBe(true);
		expect(isStateFormat('tend.v9999')).toBe(true);
	});

	it.each([
		'tend.v0',
		'tend.v',
		'tend.v01',
		'tend.vX',
		'tend.v1.1',
		'tend.v1 ',
		' tend.v1',
		'tend.v10000',
		'',
		'v1'
	])('names no version at all: %s', (format) => {
		expect(isStateFormat(format)).toBe(false);
	});

	// A JSON body can carry an array where a string belongs, and an array of one
	// string is exactly what a loose pattern test would read as that string.
	it.each([['tend.v1'], 1, null, undefined, { toString: () => 'tend.v1' }])(
		'is not a label at all when it is not a string: %s',
		(format) => {
			expect(isStateFormat(format)).toBe(false);
		}
	);
});

describe('parsing the text storage hands back', () => {
	it('reads a document that is there', () => {
		const result = parseStateDocument(JSON.stringify(atCurrentVersion()));

		expect(result.ok).toBe(true);
	});

	it.each(['{not json', '', 'null', '[]'])('refuses text that is not a document: %s', (raw) => {
		expect(parseStateDocument(raw)).toMatchObject({ ok: false, reason: 'malformed' });
	});
});

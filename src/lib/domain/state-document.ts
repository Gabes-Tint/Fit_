import { DEFAULT_LOAD_UNIT, DEFAULT_REST_SECONDS, DEFAULT_UNITS, type TendState } from './types';

/**
 * The stored shape of the whole application state, and the ladder that carries
 * an older one forward to it.
 *
 * Two devices are never on the same build. A phone runs whatever Android last
 * installed; the browser runs whatever the server last deployed. They share one
 * document, so the document has to say which shape it is in, and every reader
 * has to know what to do with a shape it was not written for:
 *
 * - **Older than this build** — migrated forward, one step at a time, by the
 *   pure functions in `MIGRATIONS`. Every shape change ships with its migration;
 *   `FIELD_CHECKS` below makes that a compile error rather than a convention.
 * - **Newer than this build** — refused. Not merged, not downgraded, not
 *   written over. An old client cannot know what a new field means, and the one
 *   safe thing it can do with a document it does not understand is leave it
 *   alone and say so.
 *
 * Nothing here reads a clock, a random source, or storage: a migration is a
 * function of its input alone, so the same stored document always upgrades to
 * the same result and can be tested without a browser.
 */

/** The shape this build reads and writes. Bumped by every shape change. */
export const SCHEMA_VERSION = 1;

/**
 * A document with no `schemaVersion` at all: everything written before this
 * ladder existed. It is a version like any other, and `MIGRATIONS[0]` is the
 * step that brings it up.
 */
const LEGACY_VERSION = 0;

/** The state as it is stored and sent, which is the state plus its version. */
export type StoredDocument = TendState & { schemaVersion: number };

/** A blank document. The one place a default value for a field is decided. */
export function emptyState(): TendState {
	return {
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
}

/** Stamp the state with the version whoever reads it next will negotiate on. */
export function storedDocument(state: TendState): StoredDocument {
	return { ...state, schemaVersion: SCHEMA_VERSION };
}

// -- the wire format label ---------------------------------------------------

/**
 * `format` on the wire is the schema version in a name the server can store
 * without reading the body. The server checks only that it is well formed: it
 * keeps the document opaque, so a version it has never heard of costs it
 * nothing, while refusing one would lock a phone running a newer build out of
 * its own account. The refusal that matters happens where the document is
 * actually read, which is here.
 */
const FORMAT_PATTERN = /^tend\.v([1-9][0-9]{0,3})$/;

export function stateFormat(version: number): string {
	return `tend.v${version}`;
}

/**
 * Whether a value is a format label naming some schema version — any version,
 * including ones this build has never heard of. Takes `unknown` because the only
 * caller is reading a request body: `['tend.v1']` stringifies to text this
 * pattern would happily match, so what arrived has to be a string before the
 * pattern sees it.
 */
export function isStateFormat(format: unknown): format is string {
	return typeof format === 'string' && FORMAT_PATTERN.test(format);
}

// -- the ladder --------------------------------------------------------------

type Document = Record<string, unknown>;

/** One rung: a pure function from the shape at `N` to the shape at `N + 1`. */
export type Migration = (document: Document) => Document;

function isPlainObject(value: unknown): value is Document {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Version 0 is every document written before the ladder existed, and the only
 * rung allowed to be forgiving: those documents were written by builds whose
 * field set is no longer knowable, so a missing field takes its default and a
 * field this build has never heard of is dropped rather than carried forward as
 * something no reader can interpret. That tolerance ends here. From version 1
 * on, a document either matches the shape or is refused — filling a gap in a
 * versioned document would be inventing data, which is exactly what this
 * replaces.
 */
function migrate_0_to_1(document: Document): Document {
	const defaults = emptyState() as unknown as Document;
	const upgraded: Document = { schemaVersion: 1 };
	for (const field of Object.keys(defaults)) {
		upgraded[field] = field in document ? document[field] : defaults[field];
	}
	return upgraded;
}

/** Ordered, one rung per version: `MIGRATIONS[n]` takes version `n` to `n + 1`. */
export const MIGRATIONS: readonly Migration[] = [migrate_0_to_1];

/**
 * Every rung from the version a document declares up to this build's, in order.
 * Taken off the ladder rather than counted out with an index, so the loop cannot
 * disagree with the array about how many rungs there are.
 */
function migrateForward(document: Document, from: number): Document {
	return MIGRATIONS.slice(from).reduce((upgraded, rung) => rung(upgraded), document);
}

// -- the shape ---------------------------------------------------------------

/**
 * Every field of the state and what counts as a value for it. Typed against
 * `TendState`, so adding a field without adding its check here does not compile
 * — which is what makes "every shape change ships with its migration" a rule the
 * build enforces rather than one a reviewer has to remember. The version itself
 * is not in here: it is read and stripped before this runs, so what is checked
 * is exactly what the application will be handed.
 *
 * Top level only. What is inside `profiles` or `workouts` is not checked here:
 * refusing somebody's whole journal over one odd entry loses far more than it
 * protects, and the ladder is what keeps those shapes honest going forward.
 */
const FIELD_CHECKS = {
	onboarded: (value: unknown) => typeof value === 'boolean',
	activeProfileId: (value: unknown) => typeof value === 'string',
	profiles: Array.isArray,
	weekPlan: Array.isArray,
	pantry: Array.isArray,
	routines: Array.isArray,
	trainingPlan: Array.isArray,
	workouts: Array.isArray,
	activeWorkout: (value: unknown) => value === null || isPlainObject(value),
	loadUnit: (value: unknown) => value === 'kg' || value === 'lb',
	restSeconds: (value: unknown) => Number.isFinite(value),
	units: (value: unknown) => value === 'metric' || value === 'imperial'
} satisfies Record<keyof TendState, (value: unknown) => boolean>;

/** The first field that does not match the shape, or `null` when all do. */
function offendingField(document: Document): string | null {
	for (const field of Object.keys(document)) {
		if (!(field in FIELD_CHECKS)) return field;
	}
	for (const [field, accepts] of Object.entries(FIELD_CHECKS)) {
		if (!accepts(document[field])) return field;
	}
	return null;
}

// -- loading -----------------------------------------------------------------

/**
 * Why a document was not loaded. `future` is the one a person can act on — the
 * app is out of date — and the one that must never be resolved by merging.
 */
export type LoadRefusal = {
	ok: false;
	reason: 'malformed' | 'future' | 'invalid';
	message: string;
};

export type LoadResult = { ok: true; state: TendState; migrated: boolean } | LoadRefusal;

export const OUTDATED_MESSAGE =
	'This copy of the app is older than your saved data. Update the app to load it — nothing was changed.';

const MALFORMED_MESSAGE = 'Your saved data could not be read, so nothing was loaded or changed.';

function refuse(reason: LoadRefusal['reason'], message: string): LoadRefusal {
	return { ok: false, reason, message };
}

/**
 * The version a document declares: absent means it predates the ladder, and
 * anything that is not a whole version at all means the document is not one.
 */
function declaredVersion(document: Document): number | null {
	const declared = document['schemaVersion'];
	if (declared === undefined) return LEGACY_VERSION;
	if (!Number.isInteger(declared) || (declared as number) < 1) return null;
	return declared as number;
}

/**
 * Whether a document was written by a build newer than this one — the question
 * the sync client asks before it decides whether it may write at all. Answered
 * by loading it rather than by reading the version twice, so it can never
 * disagree with what `loadStateDocument` would do with the same document.
 */
export function documentIsFromTheFuture(value: unknown): boolean {
	const result = loadStateDocument(value);
	return !result.ok && result.reason === 'future';
}

/** A document without the version field, which is storage's business, not the app's. */
function stateOf(document: Document): Document {
	const state = { ...document };
	delete state['schemaVersion'];
	return state;
}

/**
 * Read a stored or received document: migrate it forward if it is behind,
 * refuse it if it is ahead, and check what comes out against the shape this
 * build expects. Every caller gets a complete `TendState` or a reason, never a
 * half-document quietly completed from defaults.
 */
export function loadStateDocument(value: unknown): LoadResult {
	if (!isPlainObject(value)) return refuse('malformed', MALFORMED_MESSAGE);
	const version = declaredVersion(value);
	if (version === null) return refuse('malformed', MALFORMED_MESSAGE);
	if (version > SCHEMA_VERSION) return refuse('future', OUTDATED_MESSAGE);
	// The version comes off before the shape is checked, so what is checked is
	// exactly what the application will be handed.
	const state = stateOf(migrateForward(value, version));
	const offender = offendingField(state);
	if (offender !== null) {
		return refuse('invalid', `${MALFORMED_MESSAGE} (the field “${offender}” is not as expected)`);
	}
	return { ok: true, state: state as unknown as TendState, migrated: version !== SCHEMA_VERSION };
}

/** The same, from the text `localStorage` hands back. */
export function parseStateDocument(raw: string): LoadResult {
	try {
		return loadStateDocument(JSON.parse(raw) as unknown);
	} catch {
		return refuse('malformed', MALFORMED_MESSAGE);
	}
}

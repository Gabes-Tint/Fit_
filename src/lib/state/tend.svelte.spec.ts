import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTINE_TEMPLATES } from '$lib/domain/exercise-catalog';
import { logFromFood } from '$lib/domain/log-entry';
import { emptyProfile } from '$lib/domain/profile';
import { RECIPE_BY_ID, RECIPES, recipeFits } from '$lib/domain/recipes';
import type {
	Injection,
	LogItem,
	LogSource,
	Meal,
	PlannedMeal,
	Profile,
	TendState
} from '$lib/domain/types';
import { DEFAULT_REST_SECONDS, PLANNED_MEALS, ZERO_MICROS } from '$lib/domain/types';
import { displayLoad } from '$lib/domain/units';
import { todayISO } from '$lib/domain/utils';
import { countsAsTraining } from '$lib/domain/workout';
import { emptyState, SCHEMA_VERSION, storedDocument } from '$lib/domain/state-document';
import { STORAGE_FULL_MESSAGE } from './storage-quota';
import { REFUSED_STORAGE_KEY, STORAGE_KEY, TendStore } from './tend.svelte';

function freshStore() {
	localStorage.clear();
	const store = new TendStore();
	store.hydrate();
	return store;
}

function logFood(
	store: TendStore,
	args: { foodId: string; servings: number; meal: Meal; date?: string; source?: LogSource }
) {
	store.addLogItems([
		logFromFood({ ...args, date: args.date ?? todayISO(), source: args.source ?? 'manual' })
	]);
}

/** `visibilityState` is read-only on a real document, so define it rather than assign. */
function setVisibility(state: DocumentVisibilityState) {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function setPlan(store: TendStore, plan: PlannedMeal[]) {
	store.state.weekPlan = plan;
	store.persist();
}

function onboarded(overrides: Partial<Profile> = {}) {
	const store = freshStore();
	store.completeOnboarding({
		profile: { ...emptyProfile({ name: 'Alex' }), ...overrides },
		household: false,
		useSample: false
	});
	return store;
}

// Uses the literal key, not the exported constant: a renamed key would round-trip against itself.
function stored(): TendState {
	const raw = localStorage.getItem('tend.v1');
	if (raw === null) throw new Error('nothing was written to localStorage');
	return JSON.parse(raw) as TendState;
}

function reloaded() {
	const store = new TendStore();
	store.hydrate();
	return store;
}

/**
 * jsdom's `Storage` is a legacy platform object backed by its own internal
 * bookkeeping, so a `vi.spyOn(localStorage, 'setItem')` is never actually
 * reached: real writes still land, but the spy sees none of them. Spying on
 * the store's own methods instead avoids that and reads on real behavior:
 * `persist` for whether a write happened at all, `write` (private, hence the
 * cast) for how many times the underlying storage call actually fired, which
 * a debounced write cancelled too late can trigger a second time.
 */
function persistSpy() {
	return vi.spyOn(TendStore.prototype, 'persist');
}

function writeSpy() {
	return vi.spyOn(TendStore.prototype as unknown as { write: () => void }, 'write');
}

/**
 * Run `body` with `globalThis.localStorage` swapped for `stub`, then put the
 * real one back. jsdom's `Storage` is a legacy platform object whose `setItem`
 * a `vi.spyOn` never actually reaches (see `persistSpy` above), so a storage
 * that behaves differently has to be a different object — the same move the
 * no-storage tests make when they swap it for `undefined`.
 */
function withStorage(stub: Storage | undefined, body: () => void) {
	const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
	try {
		body();
	} finally {
		if (real) Object.defineProperty(globalThis, 'localStorage', real);
	}
}

/**
 * A device whose writes fail with `error` until `allow()` is called, and which
 * keeps what it accepts in `kept` so a write that lands can be read back.
 */
function refusingStorage(error: unknown) {
	const kept = new Map<string, string>();
	let refusing = true;
	const storage = {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (refusing) throw error;
			kept.set(key, value);
		},
		removeItem: (key: string) => void kept.delete(key),
		clear: () => kept.clear(),
		key: () => null,
		get length() {
			return kept.size;
		}
	};
	return {
		kept,
		storage: storage as unknown as Storage,
		allow: () => {
			refusing = false;
		}
	};
}

/** What a browser out of room throws. */
function quotaError(): DOMException {
	return new DOMException('exceeded the quota', 'QuotaExceededError');
}

function customEntry(overrides: Partial<LogItem> = {}): LogItem {
	return {
		id: 'custom',
		foodId: null,
		date: todayISO(),
		meal: 'lunch',
		servings: 2,
		source: 'manual',
		name: 'Leftovers',
		kcal: 400,
		protein: 20,
		carbs: 40,
		fat: 15,
		micros: { ...ZERO_MICROS, fiber: 4 },
		servingLabel: 'plate',
		...overrides
	};
}

const dose: Omit<Injection, 'id'> = {
	date: '2026-06-01',
	medication: 'semaglutide',
	doseMg: 0.5,
	site: 'abdomen',
	appetite: 3,
	sideEffects: [],
	notes: ''
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('hydration', () => {
	it('starts empty when there is nothing stored', () => {
		const store = freshStore();
		expect(store.state.onboarded).toBe(false);
		expect(store.state.activeProfileId).toBe('');
		expect(store.state.profiles).toEqual([]);
		expect(store.state.weekPlan).toEqual([]);
		expect(store.state.pantry).toEqual([]);
		expect(store.hydrated).toBe(true);
	});

	it('restores a previously persisted state', () => {
		const first = onboarded();
		const second = reloaded();
		expect(second.state.profiles).toHaveLength(first.state.profiles.length);
		expect(second.state.activeProfileId).toBe(first.state.activeProfileId);
	});

	it('leaves what is already in memory alone when there is nothing stored', () => {
		const store = new TendStore();
		store.state.profiles.push(emptyProfile({ name: 'Alex' }));
		store.hydrate();
		expect(store.state.profiles).toHaveLength(1);
	});

	// Not "starts clean": starting clean means the next write puts an empty
	// document where something unreadable was, and whatever that text was, it is
	// the only copy this device has. Refusing keeps it.
	it('refuses a corrupt payload rather than throwing, and keeps it', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		const store = new TendStore();
		store.hydrate();
		expect(store.hydrated).toBe(true);
		expect(store.refusal?.reason).toBe('malformed');
		expect(store.state.onboarded).toBe(false);
		store.togglePantry('oats');
		store.persist();
		expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json');
	});

	it('fills in keys missing from an older payload', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ onboarded: true }));
		const store = new TendStore();
		store.hydrate();
		expect(store.state.pantry).toEqual([]);
		expect(store.state.weekPlan).toEqual([]);
		expect(store.state.activeProfileId).toBe('');
	});

	// An older payload lacks these keys; a session opened on `undefined` would count down from NaN.
	it('gives an older payload the default unit and rest length', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ onboarded: true, workouts: [] }));
		const store = new TendStore();
		store.hydrate();
		expect(store.state.loadUnit).toBe('kg');
		expect(store.state.restSeconds).toBe(90);
	});

	it('does not re-read storage once hydrated', () => {
		const store = freshStore();
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ onboarded: true }));
		store.hydrate();
		expect(store.state.onboarded).toBe(false);
	});
});

describe('onboarding', () => {
	it('marks the app as onboarded', () => {
		const store = onboarded();
		expect(store.state.onboarded).toBe(true);
		expect(store.state.profiles).toHaveLength(1);
	});

	it('makes the new profile active', () => {
		const store = onboarded();
		expect(store.profile?.name).toBe('Alex');
		expect(store.state.activeProfileId).toBe(store.state.profiles[0]?.id);
	});

	it('builds a week of meals', () => {
		expect(onboarded().state.weekPlan.length).toBeGreaterThan(0);
	});

	it('persists explicitly after generating the plan, not only through it', () => {
		const spy = persistSpy();
		onboarded({ name: 'Alex' });
		expect(spy).toHaveBeenCalledTimes(2);
		const persisted = stored();
		expect(persisted.profiles.map((p) => p.name)).toContain('Alex');
		expect(persisted.weekPlan.length).toBeGreaterThan(0);
		spy.mockRestore();
	});

	it('adds a second person when a household is requested', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: 'Alex' }),
			household: true,
			useSample: false
		});
		expect(store.state.profiles).toHaveLength(2);
		expect(store.state.profiles[1]?.name).toBe('Jordan');
		expect(store.state.profiles[1]?.restrictions).toEqual(['vegetarian']);
	});

	it('plans every slot for everyone in the household', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: 'Alex' }),
			household: true,
			useSample: false
		});
		const ids = store.state.profiles.map((p) => p.id);
		expect(ids).toHaveLength(2);
		for (const slot of store.state.weekPlan) {
			expect(slot.forProfileIds).toEqual(ids);
		}
	});

	it('seeds a lived-in log when the sample journal is chosen', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: 'Alex' }),
			household: false,
			useSample: true
		});
		expect(store.profile?.log.length).toBeGreaterThan(0);
		expect(store.state.profiles).toHaveLength(1);
	});

	it('keeps the entered name over the sample profile name', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: 'Robin' }),
			household: false,
			useSample: true
		});
		expect(store.profile?.name).toBe('Robin');
	});

	it('falls back to the sample profile name when none was entered', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: '' }),
			household: false,
			useSample: true
		});
		expect(store.profile?.name).toBe('Alex');
	});
});

describe('the log', () => {
	it('adds an entry for the active profile', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		expect(store.profile?.log).toHaveLength(1);
		expect(store.profile?.log[0]?.kcal).toBe(144);
		expect(store.profile?.log[0]?.protein).toBe(12.6);
	});

	it('dates a new entry today by default', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		expect(store.profile?.log[0]?.date).toBe(todayISO());
	});

	it('calls an entry manual when nothing else said where it came from', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		expect(store.profile?.log[0]?.source).toBe('manual');
	});

	it('keeps the source an entry was logged with', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast', source: 'photo' });
		expect(store.profile?.log[0]?.source).toBe('photo');
	});

	it('re-derives a catalog entry from its food when the servings change', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 0.5, meal: 'breakfast' });
		const id = store.profile?.log[0]?.id ?? '';
		expect(store.profile?.log[0]?.protein).toBe(3.2);
		store.updateLog(id, { servings: 2 });
		const after = store.profile?.log[0];
		// Only the source food produces these numbers; ratio scaling would not.
		expect(after?.servings).toBe(2);
		expect(after?.kcal).toBe(144);
		expect(after?.protein).toBe(12.6);
		expect(after?.fat).toBe(9.6);
		expect(after?.micros.iron).toBe(1.8);
		expect(after?.micros.zinc).toBe(1.3);
	});

	it('scales a custom entry by ratio when it has no catalog food behind it', () => {
		const store = onboarded();
		store.addLogItems([customEntry()]);
		// The ratio is 1.5, not 1 (which patching before rescaling would produce).
		store.updateLog('custom', { servings: 3 });
		const after = store.profile?.log[0];
		expect(after?.servings).toBe(3);
		expect(after?.kcal).toBe(600);
		expect(after?.protein).toBe(30);
		expect(after?.carbs).toBe(60);
		expect(after?.fat).toBe(22.5);
		expect(after?.micros.fiber).toBe(6);
	});

	it('leaves a catalog-sourced entry’s grams unchanged when servings change (#232)', () => {
		const store = onboarded();
		store.addLogItems([customEntry({ grams: 37 })]);
		store.updateLog('custom', { servings: 3 });
		const after = store.profile?.log[0];
		expect(after?.servings).toBe(3);
		expect(after?.grams).toBe(37);
	});

	it('leaves a custom entry logged at zero servings where it is', () => {
		const store = onboarded();
		store.addLogItems([customEntry({ servings: 0 })]);
		store.updateLog('custom', { servings: 2 });
		const after = store.profile?.log[0];
		expect(after?.servings).toBe(2);
		expect(after?.kcal).toBe(400);
		expect(after?.protein).toBe(20);
	});

	it('leaves other fields alone when patching without a serving change', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		const id = store.profile?.log[0]?.id ?? '';
		store.updateLog(id, { note: 'runny' });
		const after = store.profile?.log[0];
		expect(after?.note).toBe('runny');
		expect(after?.servings).toBe(1);
		expect(after?.kcal).toBe(72);
	});

	it('does not re-derive an edited entry when the serving count is unchanged', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		const id = store.profile?.log[0]?.id ?? '';
		store.updateLog(id, { kcal: 999 });
		store.updateLog(id, { servings: 1, note: 'as weighed' });
		const after = store.profile?.log[0];
		expect(after?.kcal).toBe(999);
		expect(after?.note).toBe('as weighed');
	});

	it('removes only the entry it was asked for', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		logFood(store, { foodId: 'egg-large', servings: 2, meal: 'lunch' });
		const first = store.profile?.log[0]?.id ?? '';
		store.removeLog(first);
		expect(store.profile?.log).toHaveLength(1);
		expect(store.profile?.log[0]?.meal).toBe('lunch');
	});

	it('ignores a log write when no profile is active', () => {
		const store = freshStore();
		store.addLogItems([customEntry()]);
		expect(store.profile).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});
});

describe('weigh-ins', () => {
	it('records a reading', () => {
		const store = onboarded();
		store.addWeight(80);
		expect(store.profile?.weights).toHaveLength(1);
		expect(store.profile?.weights[0]?.kg).toBe(80);
		expect(store.profile?.weights[0]?.id.startsWith('w-')).toBe(true);
	});

	it('replaces rather than appends a second reading on the same day', () => {
		const store = onboarded();
		store.addWeight(80);
		store.addWeight(79.5);
		expect(store.profile?.weights).toHaveLength(1);
		expect(store.profile?.weights[0]?.kg).toBe(79.5);
	});

	it('keeps readings in date order', () => {
		const store = onboarded();
		store.addWeight(80, '2026-06-02');
		store.addWeight(81, '2026-06-01');
		expect(store.profile?.weights.map((w) => w.date)).toEqual(['2026-06-01', '2026-06-02']);
	});
});

describe('injections', () => {
	it('records a dose', () => {
		const store = onboarded();
		store.addInjection(dose);
		expect(store.profile?.injections).toHaveLength(1);
		expect(store.profile?.injections[0]?.doseMg).toBe(0.5);
		expect(store.profile?.injections[0]?.id.startsWith('i-')).toBe(true);
	});

	it('patches only the active profile', () => {
		const store = onboarded();
		const other = emptyProfile({ name: 'Jordan' });
		store.state.profiles.push(other);
		store.patchActive((p) => ({ ...p, glp1: true }));
		expect(store.profile?.glp1).toBe(true);
		expect(store.state.profiles.find((p) => p.id === other.id)?.glp1).toBe(false);
	});

	it('reads the profile matching the active id, not just the first one', () => {
		const store = onboarded();
		const other = emptyProfile({ name: 'Jordan' });
		store.state.profiles.push(other);
		store.state.activeProfileId = other.id;
		expect(store.profile?.name).toBe('Jordan');
	});
});

describe('the week plan', () => {
	it('fills three meals for each of seven days', () => {
		expect(onboarded().state.weekPlan).toHaveLength(21);
	});

	it('only plans recipes that exist', () => {
		for (const slot of onboarded().state.weekPlan) {
			expect(RECIPE_BY_ID[slot.recipeId]).toBeDefined();
		}
	});

	it('matches each slot to its own meal', () => {
		for (const slot of onboarded().state.weekPlan) {
			expect(RECIPE_BY_ID[slot.recipeId]?.meal).toBe(slot.meal);
		}
	});

	it('uses every recipe a meal offers before repeating one', () => {
		const store = onboarded();
		for (const meal of PLANNED_MEALS) {
			const chosen = new Set(
				store.state.weekPlan.filter((p) => p.meal === meal).map((p) => p.recipeId)
			);
			const available = RECIPES.filter((r) => r.meal === meal).length;
			expect(chosen.size).toBe(Math.min(7, available));
		}
	});

	it('honours a household restriction', () => {
		const store = onboarded({ restrictions: ['vegetarian'] });
		for (const slot of store.state.weekPlan) {
			expect(RECIPE_BY_ID[slot.recipeId]?.suits).toContain('vegetarian');
		}
	});

	it('treats one member on a GLP-1 as a protein floor for the household', () => {
		const store = onboarded({ glp1: true });
		store.state.profiles.push(emptyProfile({ name: 'Jordan' }));
		store.generatePlan();
		expect(store.state.weekPlan).toHaveLength(21);
		for (const slot of store.state.weekPlan) {
			expect(RECIPE_BY_ID[slot.recipeId]?.suits).toContain('high-protein');
		}
	});

	it('bends a restriction rather than leaving a meal unplanned', () => {
		// No breakfast recipe is vegan, so those slots fall back to the full list.
		const store = onboarded({ restrictions: ['vegan'] });
		const plan = store.state.weekPlan;
		expect(plan).toHaveLength(21);
		const breakfasts = plan.filter((p) => p.meal === 'breakfast');
		expect(breakfasts).toHaveLength(7);
		for (const slot of breakfasts) {
			expect(RECIPE_BY_ID[slot.recipeId]?.meal).toBe('breakfast');
		}
		expect(new Set(breakfasts.map((p) => p.recipeId)).size).toBeGreaterThan(1);
		for (const slot of plan.filter((p) => p.meal !== 'breakfast')) {
			expect(RECIPE_BY_ID[slot.recipeId]?.suits).toContain('vegan');
		}
	});

	it('steps the slot it was asked for on to the next recipe in the pool', () => {
		const store = onboarded();
		const dinners = RECIPES.filter((r) => r.meal === 'dinner');
		const breakfast = RECIPES.filter((r) => r.meal === 'breakfast')[0]?.id ?? '';
		// A different day's dinner and a same-day breakfast sit between: matching on half of date-and-meal picks the wrong slot.
		setPlan(store, [
			{ date: '2026-06-02', meal: 'dinner', recipeId: dinners[0]?.id ?? '', forProfileIds: [] },
			{ date: '2026-06-01', meal: 'breakfast', recipeId: breakfast, forProfileIds: [] },
			{ date: '2026-06-01', meal: 'dinner', recipeId: dinners[1]?.id ?? '', forProfileIds: [] }
		]);
		store.swapPlanned('2026-06-01', 'dinner');
		expect(store.state.weekPlan[2]?.recipeId).toBe(dinners[2]?.id);
		expect(store.state.weekPlan[0]?.recipeId).toBe(dinners[0]?.id);
		expect(store.state.weekPlan[1]?.recipeId).toBe(breakfast);
	});

	it('swaps within the recipes the household can still eat', () => {
		const store = onboarded({ restrictions: ['vegetarian'] });
		const fits = RECIPES.filter((r) => r.meal === 'dinner' && recipeFits(r, ['vegetarian']));
		expect(fits.length).toBeGreaterThan(1);
		setPlan(store, [
			{ date: '2026-06-01', meal: 'dinner', recipeId: fits[0]?.id ?? '', forProfileIds: [] }
		]);
		store.swapPlanned('2026-06-01', 'dinner');
		expect(store.state.weekPlan[0]?.recipeId).toBe(fits[1]?.id);
	});

	it('leaves the slot alone when only one recipe still fits', () => {
		// Vegan narrows dinner to a single recipe, so the "next" one is the one already there:
		// the guard must skip the rebuild rather than replace it with an identical copy.
		const store = onboarded({ restrictions: ['vegan'] });
		const before = store.state.weekPlan;
		const dinner = before.find((p) => p.meal === 'dinner');
		if (!dinner) throw new Error('no dinner slot was planned');
		store.swapPlanned(dinner.date, 'dinner');
		expect(store.state.weekPlan).toBe(before);
	});

	it('adds a food', () => {
		const store = onboarded();
		store.togglePantry('egg-large');
		expect(store.state.pantry).toContain('egg-large');
	});

	it('removes only the food toggled off', () => {
		const store = onboarded();
		store.togglePantry('egg-large');
		store.togglePantry('oats');
		store.togglePantry('egg-large');
		expect(store.state.pantry).toEqual(['oats']);
	});
});

describe('whole-state operations', () => {
	it('clears everything on reset', () => {
		const store = onboarded();
		store.resetAll();
		expect(store.state.onboarded).toBe(false);
		expect(store.state.profiles).toEqual([]);
		expect(store.state.activeProfileId).toBe('');
		expect(store.state.weekPlan).toEqual([]);
	});

	it('clears persisted storage on reset', () => {
		const store = onboarded();
		store.resetAll();
		expect(reloaded().state.onboarded).toBe(false);
	});

	it('writes the payload under the key an older build would read', () => {
		onboarded();
		expect(localStorage.getItem('tend.v1')).not.toBeNull();
		expect(stored().onboarded).toBe(true);
		expect(stored().profiles[0]?.name).toBe('Alex');
	});

	it('saves each change to the log as it is made', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		expect(stored().profiles[0]?.log).toHaveLength(1);
		const id = store.profile?.log[0]?.id ?? '';
		store.updateLog(id, { servings: 2 });
		expect(stored().profiles[0]?.log[0]?.kcal).toBe(144);
		store.removeLog(id);
		expect(stored().profiles[0]?.log).toEqual([]);
	});

	it('saves measurements as they are recorded', () => {
		const store = onboarded();
		store.addWeight(80);
		expect(stored().profiles[0]?.weights[0]?.kg).toBe(80);
		store.addInjection(dose);
		expect(stored().profiles[0]?.injections).toHaveLength(1);
	});

	it('saves each change to the profile list as it is made', () => {
		const store = onboarded();
		const other = emptyProfile({ name: 'Jordan' });
		store.state.profiles.push(other);
		store.persist();
		expect(stored().profiles).toHaveLength(2);
		store.state.activeProfileId = other.id;
		store.persist();
		expect(stored().activeProfileId).toBe(other.id);
		store.patchActive((p) => ({ ...p, glp1: true }));
		expect(stored().profiles[1]?.glp1).toBe(true);
	});

	it('saves each change to the plan and the pantry as it is made', () => {
		const store = onboarded();
		const dinners = RECIPES.filter((r) => r.meal === 'dinner');
		setPlan(store, [
			{ date: '2026-06-01', meal: 'dinner', recipeId: dinners[0]?.id ?? '', forProfileIds: [] }
		]);
		expect(stored().weekPlan).toHaveLength(1);
		store.swapPlanned('2026-06-01', 'dinner');
		expect(stored().weekPlan[0]?.recipeId).toBe(dinners[1]?.id);
		store.togglePantry('egg-large');
		expect(stored().pantry).toEqual(['egg-large']);
		store.generatePlan();
		expect(stored().weekPlan).toHaveLength(21);
	});

	it('does not write anything before the store is hydrated', () => {
		const store = new TendStore();
		store.state.profiles.push(emptyProfile({ name: 'Alex' }));
		expect(store.state.profiles).toHaveLength(1);
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('neither reads nor writes where there is no localStorage at all', () => {
		// A server render reaches `hydrate()` before any browser storage exists.
		const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
		try {
			const store = new TendStore();
			store.hydrate();
			store.state.profiles.push(emptyProfile({ name: 'Alex' }));
			expect(() => store.persist()).not.toThrow();
			expect(store.hydrated).toBe(true);
			expect(store.state.profiles).toHaveLength(1);
		} finally {
			if (real) Object.defineProperty(globalThis, 'localStorage', real);
		}
	});

	it('reloads into the state it wrote', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		store.addWeight(80);
		store.togglePantry('oats');
		const next = reloaded();
		expect(next.state.activeProfileId).toBe(store.state.activeProfileId);
		expect(next.state.profiles[0]?.log[0]?.kcal).toBe(144);
		expect(next.state.profiles[0]?.weights[0]?.kg).toBe(80);
		expect(next.state.pantry).toEqual(['oats']);
		expect(next.state.weekPlan).toHaveLength(21);
	});
});

describe('a device with no room left', () => {
	it('says nothing about storage before anything has been written', () => {
		// The badge reads this on its first paint, before any write has had the
		// chance to report anything, so the quiet answer has to be the default.
		expect(new TendStore().storage).toBe('ok');
	});

	it('completes the action rather than throwing out of it', () => {
		// The whole point of #300: the quota wall used to arrive as an exception
		// out of whatever the person had just tapped.
		const store = onboarded();
		const full = refusingStorage(quotaError());
		withStorage(full.storage, () => {
			expect(() => store.addWeight(80)).not.toThrow();
		});
		expect(store.profile?.weights.at(-1)?.kg).toBe(80);
	});

	it('says so, because a phone that quietly stops saving is the worse failure', () => {
		const store = onboarded();
		expect(store.storage).toBe('ok');
		withStorage(refusingStorage(quotaError()).storage, () => store.addWeight(80));
		expect(store.storage).toBe('full');
	});

	it('says the same for the name Firefox raises instead', () => {
		const store = onboarded();
		const firefox = new DOMException('persistent storage', 'NS_ERROR_DOM_QUOTA_REACHED');
		withStorage(refusingStorage(firefox).storage, () => store.addWeight(80));
		expect(store.storage).toBe('full');
	});

	it('still offers the change to the server, which is where it can still be kept', () => {
		// A device out of room is exactly the case where the copy on the server is
		// the only copy there is going to be, so the push is the last thing to
		// give up on rather than the first.
		const store = onboarded();
		const pushes = vi.fn();
		store.watch(pushes);
		withStorage(refusingStorage(quotaError()).storage, () => store.addWeight(80));
		expect(pushes).toHaveBeenCalled();
	});

	it('has nothing to say about storage while there is room', () => {
		// The badge asks the store what to say rather than working it out from the
		// status, so the quiet answer has to come from here too.
		expect(onboarded().storageNotice).toBeNull();
	});

	it('offers the sentence to say once there is not', () => {
		const store = onboarded();
		withStorage(refusingStorage(quotaError()).storage, () => store.addWeight(80));
		expect(store.storageNotice).toContain('not saved on it');
	});

	it('takes the warning back down once a write lands again', () => {
		const store = onboarded();
		const full = refusingStorage(quotaError());
		withStorage(full.storage, () => {
			store.addWeight(80);
			expect(store.storage).toBe('full');
			full.allow();
			store.addWeight(79);
			expect(store.storage).toBe('ok');
			expect(full.kept.get(STORAGE_KEY)).toContain('79');
		});
	});

	it('takes it back down when signing out frees the room', () => {
		const store = onboarded();
		withStorage(refusingStorage(quotaError()).storage, () => store.addWeight(80));
		expect(store.storage).toBe('full');
		store.clear();
		expect(store.storage).toBe('ok');
	});

	it('keeps a document it had to refuse, rather than throwing over it', () => {
		// `setAside` writes too, and a full device is the likeliest moment for a
		// server document to arrive over one this build could not read.
		const store = onboarded();
		store.refusal = { ok: false, reason: 'future', message: 'Update the app to load it.' };
		const full = refusingStorage(quotaError());
		withStorage(full.storage, () => {
			expect(store.replace(storedDocument(emptyState()))).toBe(true);
		});
		expect(store.storage).toBe('full');
	});

	it('says nothing either way where there is no storage to be full', () => {
		// A server render has no device to call full, and a write that reached no
		// storage at all is no evidence that room has been found either. Both
		// directions, because reporting either one is a lie.
		const store = onboarded();
		withStorage(undefined, () => expect(() => store.addWeight(80)).not.toThrow());
		expect(store.storage).toBe('ok');

		withStorage(refusingStorage(quotaError()).storage, () => store.addWeight(79));
		expect(store.storage).toBe('full');
		withStorage(undefined, () => store.addWeight(78));
		expect(store.storage).toBe('full');
	});

	it('lets a failure that is not the quota wall through instead of blaming the device', () => {
		// Reporting a full phone for every storage failure would be the same
		// silence wearing a different label: nothing would ever be looked into.
		const store = onboarded();
		withStorage(refusingStorage(new TypeError('storage is broken')).storage, () => {
			expect(() => store.addWeight(80)).toThrow(TypeError);
		});
		expect(store.storage).toBe('ok');
	});
});

describe('what the app says about a full device', () => {
	it('says the changes are not saved on it, rather than only that something failed', () => {
		expect(STORAGE_FULL_MESSAGE).toContain('not saved on it');
	});

	it('says what to do about it, since waiting is not it', () => {
		expect(STORAGE_FULL_MESSAGE).toContain('Export a backup');
	});
});

describe('guards when nothing is active', () => {
	it('ignores a serving change', () => {
		const store = freshStore();
		store.updateLog('nope', { servings: 2 });
		expect(store.profile).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('ignores a removal', () => {
		const store = freshStore();
		store.removeLog('nope');
		expect(store.profile).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('ignores a weigh-in', () => {
		const store = freshStore();
		store.addWeight(80);
		expect(store.profile).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('ignores a dose', () => {
		const store = freshStore();
		store.addInjection(dose);
		expect(store.profile).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('leaves unrelated entries untouched when patching', () => {
		const store = onboarded();
		logFood(store, { foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		store.updateLog('not-this-one', { servings: 5 });
		expect(store.profile?.log[0]?.servings).toBe(1);
		expect(store.profile?.log[0]?.kcal).toBe(72);
	});
});

describe('the sample household', () => {
	it('adds the second sample profile', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: emptyProfile({ name: 'Alex' }),
			household: true,
			useSample: true
		});
		expect(store.state.profiles).toHaveLength(2);
	});

	it('carries an entered weight into an empty start', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: {
				...emptyProfile({ name: 'Alex' }),
				weights: [{ id: 'w', date: '2026-06-01', kg: 72 }]
			},
			household: false,
			useSample: false
		});
		expect(store.profile?.weights[0]?.kg).toBe(72);
	});

	it('plans a week that suits every member of a mixed household', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: { ...emptyProfile({ name: 'Alex' }), restrictions: ['vegan'] },
			household: true,
			useSample: false
		});
		expect(store.state.weekPlan.length).toBeGreaterThan(0);
		for (const slot of store.state.weekPlan.filter((p) => p.meal !== 'breakfast')) {
			expect(RECIPE_BY_ID[slot.recipeId]?.suits).toContain('vegan');
		}
	});

	it('still plans a week for an impossible set of restrictions', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: {
				...emptyProfile({ name: 'Alex' }),
				restrictions: ['vegan', 'nut-free', 'gluten-free', 'low-sodium', 'high-protein']
			},
			household: false,
			useSample: false
		});
		expect(store.state.weekPlan).toHaveLength(21);
	});

	it('raises protein for a GLP-1 household', () => {
		const store = freshStore();
		store.completeOnboarding({
			profile: { ...emptyProfile({ name: 'Alex' }), glp1: true, goal: 'glp1' },
			household: false,
			useSample: false
		});
		expect(store.state.weekPlan).toHaveLength(21);
		for (const slot of store.state.weekPlan) {
			expect(RECIPE_BY_ID[slot.recipeId]?.suits).toContain('high-protein');
		}
	});

	it('leaves a slot alone when there is nothing to swap it for', () => {
		const store = onboarded();
		const before = [...store.state.weekPlan];
		store.swapPlanned('1999-01-01', 'dinner');
		expect(store.state.weekPlan).toHaveLength(before.length);
		expect(store.state.weekPlan.map((p) => p.recipeId)).toEqual(before.map((p) => p.recipeId));
	});
});

function withRoutine() {
	const store = freshStore();
	store.useTemplate('fb');
	return store;
}

function inSession() {
	const store = withRoutine();
	store.startWorkout('full-body');
	return store;
}

function template(id: string) {
	const found = ROUTINE_TEMPLATES.find((t) => t.id === id);
	if (!found) throw new Error(`test fixture references unknown template: ${id}`);
	return found;
}

describe('starting from a template', () => {
	it('takes the routines the template ships', () => {
		const store = withRoutine();
		expect(store.state.routines).toHaveLength(1);
		expect(store.state.routines[0]?.id).toBe('full-body');
		expect(store.state.routines[0]?.name).toBe('Full body');
		expect(store.state.routines[0]?.exercises.map((e) => e.name)).toEqual(
			template('fb').routines[0]?.exercises.map((e) => e.name)
		);
	});

	// The template says what a session is, not when it runs — the days are chosen
	// in the week view rather than guessed from a frequency.
	it('plans no days, because a template does not know which days you train', () => {
		expect(withRoutine().state.trainingPlan).toEqual([]);
	});

	it('takes every routine of a rotation, not just the first', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		expect(store.state.routines.map((r) => r.id)).toEqual(['push', 'pull', 'legs']);
	});

	it('takes nothing from a template it has never heard of', () => {
		const store = freshStore();
		store.useTemplate('nope');
		expect(store.state.routines).toEqual([]);
		expect(store.state.trainingPlan).toEqual([]);
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('replaces an earlier choice rather than adding to it', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.planDay('2026-01-05', 'push');
		store.useTemplate('fb');
		expect(store.state.routines).toHaveLength(1);
		// The days went with the routines they named; a plan pointing at a routine
		// that no longer exists would draw a week nobody can train.
		expect(store.state.trainingPlan).toEqual([]);
	});

	it('leaves the shipped template alone when the copy is edited', () => {
		const store = withRoutine();
		const before = template('fb').routines[0]?.exercises[0]?.load;
		store.bumpRoutineExercise('full-body', 0, 'load', 1);
		expect(store.state.routines[0]?.exercises[0]?.load).toBe((before ?? 0) + 2.5);
		expect(template('fb').routines[0]?.exercises[0]?.load).toBe(before);
	});

	it('saves the routines as it takes them', () => {
		withRoutine();
		expect(stored().routines).toHaveLength(1);
		expect(stored().trainingPlan).toEqual([]);
	});
});

describe('routines', () => {
	it('opens a new routine and hands it back', () => {
		const store = freshStore();
		const routine = store.createRoutine();
		expect(routine.name).toBe('New routine');
		expect(routine.id.startsWith('r-')).toBe(true);
		expect(store.state.routines).toHaveLength(1);
		expect(store.routine(routine.id)).toBeDefined();
	});

	it('has no routine to hand back under an id nobody used', () => {
		expect(freshStore().routine('nope')).toBeUndefined();
	});

	it('renames a routine', () => {
		const store = withRoutine();
		store.updateRoutine('full-body', { name: 'Everything' });
		expect(store.routine('full-body')?.name).toBe('Everything');
	});

	it('leaves the other routines alone when one is renamed', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.updateRoutine('pull', { name: 'Back day' });
		expect(store.routine('push')?.name).toBe('Chest & Shoulders');
		expect(store.routine('pull')?.name).toBe('Back day');
	});

	it('opens a new routine in the rotation, with nothing said about deleting it', () => {
		const store = freshStore();
		expect(store.createRoutine().deletedAt).toBeNull();
		store.useTemplate('ppl');
		expect(store.state.routines.map((r) => r.deletedAt)).toEqual([null, null, null]);
	});

	it('flags the routine it was asked to delete, with the day it happened', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.removeRoutine('pull', '2026-03-04');
		expect(store.routine('pull')?.deletedAt).toBe('2026-03-04');
	});

	it('deletes on today when the caller names no day', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.removeRoutine('pull');
		expect(store.routine('pull')?.deletedAt).toBe(todayISO());
	});

	// The row stays because past planned days point at it, and those days are the
	// denominator of adherence: dropping it would raise the score for sessions
	// that were missed, and leave the days that asked for it with no name to show.
	it('keeps the deleted routine resolvable by id, so past days can still name it', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.removeRoutine('pull', '2026-03-04');
		expect(store.routine('pull')?.name).toBe('Back & Arms');
		expect(store.state.routines.map((r) => r.id)).toEqual(['push', 'pull', 'legs']);
	});

	it('stops offering it, which is what a list or a picker reads', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.removeRoutine('pull', '2026-03-04');
		expect(store.routines.map((r) => r.id)).toEqual(['push', 'legs']);
	});

	it('clears the days from the deletion onwards, and only those', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.planDay('2026-03-02', 'pull');
		store.planDay('2026-03-04', 'pull');
		store.planDay('2026-03-04', 'legs');
		store.planDay('2026-03-09', 'pull');
		store.removeRoutine('pull', '2026-03-04');
		expect(store.state.trainingPlan).toEqual([
			{ date: '2026-03-02', routineIds: ['pull'] },
			{ date: '2026-03-04', routineIds: ['legs'] }
		]);
	});

	it('has nothing to delete under an id nobody used, and leaves the plan alone', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.planDay('2026-03-09', 'legs');
		store.removeRoutine('nope', '2026-03-04');
		expect(store.state.routines.map((r) => r.deletedAt)).toEqual([null, null, null]);
		expect(store.state.trainingPlan).toEqual([{ date: '2026-03-09', routineIds: ['legs'] }]);
	});

	it('will not start a deleted routine, any more than one that was never there', () => {
		const store = freshStore();
		store.useTemplate('ppl');
		store.removeRoutine('pull', '2026-03-04');
		expect(store.startWorkout('pull')).toBeNull();
		expect(store.state.activeWorkout).toBeNull();
		expect(store.startWorkout('push')).not.toBeNull();
	});

	it('saves each change to the routine list as it is made', () => {
		const store = freshStore();
		const routine = store.createRoutine();
		expect(stored().routines).toHaveLength(1);
		store.updateRoutine(routine.id, { name: 'Everything' });
		expect(stored().routines[0]?.name).toBe('Everything');
		store.removeRoutine(routine.id, '2026-03-04');
		expect(stored().routines).toHaveLength(1);
		expect(stored().routines[0]?.deletedAt).toBe('2026-03-04');
	});
});

describe('the movements in a routine', () => {
	it('adds a library movement at three sets of ten, at bodyweight', () => {
		const store = freshStore();
		const routine = store.createRoutine();
		store.addExercises(routine.id, ['Deadlift']);
		expect(store.routine(routine.id)?.exercises).toEqual([
			{ name: 'Deadlift', group: 'Legs', sets: 3, reps: 10, load: 0 }
		]);
	});

	it('adds to the end rather than to the front', () => {
		const store = withRoutine();
		store.addExercises('full-body', ['Deadlift']);
		expect(store.routine('full-body')?.exercises.at(-1)?.name).toBe('Deadlift');
		expect(store.routine('full-body')?.exercises).toHaveLength(7);
	});

	it('adds nothing for a name the library does not know', () => {
		const store = withRoutine();
		store.addExercises('full-body', ['Tyre Flip']);
		expect(store.routine('full-body')?.exercises).toHaveLength(6);
	});

	it('adds nothing when nothing was picked', () => {
		const store = withRoutine();
		const spy = persistSpy();
		store.addExercises('full-body', []);
		expect(store.routine('full-body')?.exercises).toHaveLength(6);
		// Nothing to add means nothing to save either, not a redundant write of the same list.
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('removes the row it was asked for', () => {
		const store = withRoutine();
		store.removeExercise('full-body', 0);
		expect(store.routine('full-body')?.exercises).toHaveLength(5);
		expect(store.routine('full-body')?.exercises[0]?.name).toBe('Bench Press');
	});

	it('does nothing for a row that is not there', () => {
		const store = withRoutine();
		const spy = persistSpy();
		store.removeExercise('full-body', 99);
		expect(store.routine('full-body')?.exercises).toHaveLength(6);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('does nothing for a routine that is not there', () => {
		const store = freshStore();
		expect(() => store.removeExercise('nope', 0)).not.toThrow();
		expect(() => store.moveExerciseUp('nope', 1)).not.toThrow();
	});

	it('moves a row up past the one above it', () => {
		const store = withRoutine();
		store.moveExerciseUp('full-body', 1);
		expect(
			store
				.routine('full-body')
				?.exercises.map((e) => e.name)
				.slice(0, 2)
		).toEqual(['Bench Press', 'Squat']);
	});

	it('leaves the first row where it is, because it has nowhere to go', () => {
		const store = withRoutine();
		const before = store.routine('full-body')?.exercises.map((e) => e.name);
		store.moveExerciseUp('full-body', 0);
		expect(store.routine('full-body')?.exercises.map((e) => e.name)).toEqual(before);
	});

	it('leaves the row where it is for an index past the end of the routine', () => {
		const store = withRoutine();
		const spy = persistSpy();
		const before = store.routine('full-body')?.exercises.map((e) => e.name);
		// The bounds check is the only thing standing between this and splicing in `undefined`.
		store.moveExerciseUp('full-body', 99);
		expect(store.routine('full-body')?.exercises.map((e) => e.name)).toEqual(before);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('steps only the row and the field it was pointed at', () => {
		const store = withRoutine();
		store.bumpRoutineExercise('full-body', 1, 'reps', 1);
		const exercises = store.routine('full-body')?.exercises ?? [];
		expect(exercises[1]?.reps).toBe(9);
		expect(exercises[1]?.sets).toBe(3);
		expect(exercises[0]?.reps).toBe(8);
	});

	it('steps the field where it lives, leaving every other row the object it was', () => {
		const store = withRoutine();
		const routine = store.routine('full-body');
		const otherRow = routine?.exercises[1];
		store.bumpRoutineExercise('full-body', 0, 'load', 1);
		// Rebuilding the routine would give every row a new identity and redraw every group.
		expect(store.routine('full-body')).toBe(routine);
		expect(store.routine('full-body')?.exercises[1]).toBe(otherRow);
	});

	it('steps nothing for a row that is not there', () => {
		const store = withRoutine();
		store.bumpRoutineExercise('full-body', 99, 'load', 1);
		store.bumpRoutineExercise('nope', 0, 'load', 1);
		store.flushPersist();
		expect(stored().routines[0]?.exercises).toHaveLength(6);
	});

	it('stops a load at bodyweight however often it is stepped down', () => {
		const store = withRoutine();
		for (let i = 0; i < 40; i++) store.bumpRoutineExercise('full-body', 0, 'load', -1);
		expect(store.routine('full-body')?.exercises[0]?.load).toBe(0);
	});

	it('saves each change to the movements as it is made', () => {
		const store = withRoutine();
		store.addExercises('full-body', ['Deadlift']);
		expect(stored().routines[0]?.exercises).toHaveLength(7);
		store.removeExercise('full-body', 6);
		expect(stored().routines[0]?.exercises).toHaveLength(6);
		store.moveExerciseUp('full-body', 1);
		expect(stored().routines[0]?.exercises[0]?.name).toBe('Bench Press');
		store.bumpRoutineExercise('full-body', 0, 'sets', 1);
		store.flushPersist();
		expect(stored().routines[0]?.exercises[0]?.sets).toBe(4);
	});
});

describe('planning days', () => {
	it('puts a routine on the day it was given', () => {
		const store = withRoutine();
		store.planDay('2026-01-07', 'full-body');
		expect(store.state.trainingPlan).toEqual([{ date: '2026-01-07', routineIds: ['full-body'] }]);
	});

	it('lets a day hold a second routine, after the first', () => {
		const store = freshStore();
		store.planDay('2026-01-07', 'lift');
		store.planDay('2026-01-07', 'run');
		expect(store.state.trainingPlan).toEqual([{ date: '2026-01-07', routineIds: ['lift', 'run'] }]);
	});

	it('takes a routine back off the day when it is tapped again', () => {
		const store = freshStore();
		store.planDay('2026-01-07', 'lift');
		store.planDay('2026-01-07', 'run');
		store.planDay('2026-01-07', 'lift');
		expect(store.state.trainingPlan).toEqual([{ date: '2026-01-07', routineIds: ['run'] }]);
	});

	// A day with nothing on it is the rest day, so it is stored as no day at all.
	it('leaves no empty day behind when the last routine comes off', () => {
		const store = freshStore();
		store.planDay('2026-01-07', 'lift');
		store.planDay('2026-01-07', 'lift');
		expect(store.state.trainingPlan).toEqual([]);
	});

	it('leaves every other day alone', () => {
		const store = freshStore();
		store.planDay('2026-01-07', 'lift');
		store.planDay('2026-01-08', 'run');
		expect(store.state.trainingPlan).toHaveLength(2);
	});

	it('keeps the plan in date order', () => {
		const store = freshStore();
		store.planDay('2026-03-09', 'lift');
		store.planDay('2026-01-07', 'lift');
		store.planDay('2026-02-04', 'run');
		expect(store.state.trainingPlan.map((day) => day.date)).toEqual([
			'2026-01-07',
			'2026-02-04',
			'2026-03-09'
		]);
	});

	it('saves the plan as it is drawn', () => {
		const store = freshStore();
		store.planDay('2026-01-07', 'push');
		expect(stored().trainingPlan).toEqual([{ date: '2026-01-07', routineIds: ['push'] }]);
	});
});

describe('running a session', () => {
	it('opens the routine into a workout to record it', () => {
		const store = inSession();
		expect(store.state.activeWorkout?.routineName).toBe('Full body');
		expect(store.state.activeWorkout?.date).toBe(todayISO());
		expect(store.state.activeWorkout?.exercises).toHaveLength(6);
		expect(store.currentExercise?.name).toBe('Squat');
		expect(store.state.activeWorkout?.id.startsWith('w-')).toBe(true);
	});

	it('writes out every prescribed set, none of them ticked', () => {
		const store = inSession();
		expect(store.currentExercise?.sets).toHaveLength(3);
		expect(store.currentExercise?.sets.every((s) => !s.done)).toBe(true);
	});

	it('starts nothing for a routine that is not there', () => {
		const store = withRoutine();
		expect(store.startWorkout('nope')).toBeNull();
		expect(store.state.activeWorkout).toBeNull();
	});

	it('starts nothing for a routine with no movements in it', () => {
		const store = freshStore();
		const routine = store.createRoutine();
		expect(store.startWorkout(routine.id)).toBeNull();
		expect(store.state.activeWorkout).toBeNull();
		expect(stored().activeWorkout).toBeNull();
	});

	it('starts a routine as soon as it has something to do', () => {
		const store = freshStore();
		const routine = store.createRoutine();
		store.addExercises(routine.id, ['Deadlift']);
		expect(store.startWorkout(routine.id)?.exercises).toHaveLength(1);
	});

	it('has no exercise on screen when no session is running', () => {
		expect(freshStore().currentExercise).toBeNull();
	});

	it('ticks a set of the exercise on screen, and ticks it back off', () => {
		const store = inSession();
		store.toggleSet(1);
		expect(store.currentExercise?.sets.map((s) => s.done)).toEqual([false, true, false]);
		store.toggleSet(1);
		expect(store.currentExercise?.sets.map((s) => s.done)).toEqual([false, false, false]);
	});

	it('leaves the other movements of the session untouched', () => {
		const store = inSession();
		store.toggleSet(0);
		expect(store.state.activeWorkout?.exercises[1]?.sets.some((s) => s.done)).toBe(false);
	});

	it('steps the reps and the load of one set', () => {
		const store = inSession();
		store.bumpSet(0, 'reps', 1);
		store.bumpSet(0, 'load', -1);
		expect(store.currentExercise?.sets[0]).toEqual({ reps: 9, load: 57.5, done: false });
		expect(store.currentExercise?.sets[1]).toEqual({ reps: 8, load: 60, done: false });
	});

	it('saves a stepped set through the debounce', () => {
		const store = inSession();
		store.bumpSet(0, 'reps', 1);
		store.flushPersist();
		expect(stored().activeWorkout?.exercises[0]?.sets[0]?.reps).toBe(9);
	});

	it('adds a set at the last one’s numbers, waiting to be ticked', () => {
		const store = inSession();
		store.bumpSet(2, 'load', 1);
		store.toggleSet(2);
		store.addSet();
		expect(store.currentExercise?.sets).toHaveLength(4);
		expect(store.currentExercise?.sets[3]).toEqual({ reps: 8, load: 62.5, done: false });
	});

	it('keeps a note against the movement it was written about', () => {
		const store = inSession();
		store.noteExercise('bar felt heavy');
		expect(store.currentExercise?.note).toBe('bar felt heavy');
		expect(store.state.activeWorkout?.exercises[1]?.note).toBe('');
	});

	it('swaps the movement without losing the sets already logged', () => {
		const store = inSession();
		store.toggleSet(0);
		store.swapExercise('Leg Press');
		expect(store.currentExercise?.name).toBe('Leg Press');
		expect(store.currentExercise?.group).toBe('Legs');
		expect(store.currentExercise?.sets[0]?.done).toBe(true);
		expect(store.state.activeWorkout?.exercises[1]?.name).toBe('Bench Press');
	});

	it('saves a swapped movement', () => {
		const store = inSession();
		store.swapExercise('Leg Press');
		expect(stored().activeWorkout?.exercises[0]?.name).toBe('Leg Press');
	});

	it('will not swap in a movement the library does not know', () => {
		const store = inSession();
		store.swapExercise('Tyre Flip');
		expect(store.currentExercise?.name).toBe('Squat');
	});

	it('moves on to the next movement', () => {
		const store = inSession();
		store.nextExercise();
		expect(store.state.activeWorkout?.exerciseIndex).toBe(1);
		expect(store.currentExercise?.name).toBe('Bench Press');
	});

	it('stops at the last movement rather than running off the end', () => {
		const store = inSession();
		for (let i = 0; i < 20; i++) store.nextExercise();
		expect(store.state.activeWorkout?.exerciseIndex).toBe(5);
		expect(store.currentExercise?.name).toBe('Calf Raise');
	});

	it('ticks the set where it lives, leaving every other set the object it was', () => {
		const store = inSession();
		const workout = store.state.activeWorkout;
		const exercise = store.currentExercise;
		const laterSet = exercise?.sets[1];
		const otherExercise = workout?.exercises[1];
		store.toggleSet(0);
		// A rebuilt workout would give every set a new identity and rerender the whole screen.
		expect(store.state.activeWorkout).toBe(workout);
		expect(store.currentExercise).toBe(exercise);
		expect(store.currentExercise?.sets[1]).toBe(laterSet);
		expect(store.state.activeWorkout?.exercises[1]).toBe(otherExercise);
		expect(store.currentExercise?.sets[0]?.done).toBe(true);
	});

	it('steps a set where it lives, leaving the sets around it the objects they were', () => {
		const store = inSession();
		const laterSet = store.currentExercise?.sets[2];
		store.bumpSet(0, 'load', 1);
		expect(store.currentExercise?.sets[2]).toBe(laterSet);
		expect(store.currentExercise?.sets[0]?.load).toBe(62.5);
	});

	it('points the next set at the first one still open, not at the count of them', () => {
		const store = inSession();
		store.toggleSet(0);
		store.toggleSet(2);
		const sets = store.currentExercise?.sets ?? [];
		// The session screen labels its button from this index, never from the count.
		expect(sets.filter((s) => s.done)).toHaveLength(2);
		expect(sets.findIndex((s) => !s.done)).toBe(1);
	});

	it('replaces an unfinished session rather than queueing a second one', () => {
		const store = inSession();
		store.toggleSet(0);
		const second = store.startWorkout('full-body');
		expect(second?.exercises[0]?.sets[0]?.done).toBe(false);
		expect(store.state.workouts).toEqual([]);
	});
});

describe('a session nobody is running', () => {
	it('has nothing to tick, step, add, note, swap or move on from', () => {
		const store = freshStore();
		store.toggleSet(0);
		store.bumpSet(0, 'load', 1);
		store.addSet();
		store.noteExercise('nothing');
		store.swapExercise('Squat');
		store.nextExercise();
		expect(store.state.activeWorkout).toBeNull();
		expect(localStorage.getItem('tend.v1')).toBeNull();
	});

	it('has nothing to file', () => {
		const store = freshStore();
		expect(store.finishWorkout()).toBeNull();
		expect(store.state.workouts).toEqual([]);
	});
});

describe('filing a session', () => {
	it('files the workout and hands it back with a finish time', () => {
		const store = inSession();
		store.toggleSet(0);
		const filed = store.finishWorkout();
		expect(filed?.finishedAt).not.toBeNull();
		expect(store.state.workouts).toHaveLength(1);
		expect(store.state.workouts[0]?.id).toBe(filed?.id);
	});

	it('clears the session once it is filed', () => {
		const store = inSession();
		store.toggleSet(0);
		store.finishWorkout();
		expect(store.state.activeWorkout).toBeNull();
		expect(store.currentExercise).toBeNull();
	});

	it('files a session where nothing was ticked rather than dropping it', () => {
		const store = inSession();
		const filed = store.finishWorkout();
		expect(filed).not.toBeNull();
		expect(filed?.finishedAt).not.toBeNull();
		expect(store.state.workouts).toHaveLength(1);
		expect(store.state.workouts[0]?.id).toBe(filed?.id);
		expect(store.state.activeWorkout).toBeNull();
	});

	it('files an empty session with every set still not ticked', () => {
		const store = inSession();
		const filed = store.finishWorkout();
		expect(filed?.exercises.flatMap((e) => e.sets).every((set) => !set.done)).toBe(true);
		expect(stored().workouts[0]?.id).toBe(filed?.id);
	});
});

describe('what counts as training', () => {
	it('counts a filed session with a set ticked in it', () => {
		const store = inSession();
		store.toggleSet(0);
		const filed = store.finishWorkout();
		expect(filed && countsAsTraining(filed)).toBe(true);
	});

	it('does not count a filed session with nothing ticked', () => {
		const store = inSession();
		const filed = store.finishWorkout();
		expect(filed && countsAsTraining(filed)).toBe(false);
	});

	it('does not count a session that is still running', () => {
		const store = inSession();
		store.toggleSet(0);
		const running = store.state.activeWorkout;
		expect(running && countsAsTraining(running)).toBe(false);
	});
});

describe('the load unit and the rest length', () => {
	it('opens on kilograms and a ninety-second rest', () => {
		const store = freshStore();
		expect(store.state.loadUnit).toBe('kg');
		expect(store.state.restSeconds).toBe(90);
	});

	it('takes the other unit and writes it down at once', () => {
		const store = freshStore();
		store.setLoadUnit('lb');
		expect(store.state.loadUnit).toBe('lb');
		expect(stored().loadUnit).toBe('lb');
		expect(reloaded().state.loadUnit).toBe('lb');
	});

	// A load is a mass held in kilograms, so there is nothing for the switch to
	// rewrite. What was lifted stays what was lifted, and only the reading moves.
	it('leaves every load already logged exactly as it was', () => {
		const store = inSession();
		store.toggleSet(0);
		store.finishWorkout();
		const loggedLoad = store.state.workouts[0]?.exercises[0]?.sets[0]?.load;
		const prescribedLoad = store.state.routines[0]?.exercises[0]?.load;
		store.setLoadUnit('lb');
		expect(store.state.workouts[0]?.exercises[0]?.sets[0]?.load).toBe(loggedLoad);
		expect(store.state.routines[0]?.exercises[0]?.load).toBe(prescribedLoad);
	});

	// The bug this canonical store exists to end: a 60 kg bench must not become a
	// 60 lb bench because somebody looked at the preference screen.
	it('reads a load that was entered in one unit as the same lift in the other', () => {
		const store = inSession();
		const entered = store.currentExercise?.sets[0]?.load;
		expect(entered).toBe(60);

		store.setLoadUnit('lb');

		const kg = store.currentExercise?.sets[0]?.load ?? 0;
		expect(displayLoad(kg, 'lb')).toBe(132.3);
		expect(displayLoad(kg, 'kg')).toBe(60);
	});

	it('steps a load by a plate in the unit it is being read in, not the one it is stored in', () => {
		const store = inSession();
		store.setLoadUnit('lb');
		const shown = () => displayLoad(store.currentExercise?.sets[0]?.load ?? 0, 'lb');
		expect(shown()).toBe(132.3);

		store.bumpSet(0, 'load', 1);

		expect(shown()).toBe(134.8);
	});

	// The reading comes back, not the stored kilograms — the step went out through
	// a number rounded to one decimal. What matters is that it settles: the drift
	// is one cycle wide and does not compound with the tapping.
	it('returns a load stepped up and back down to the number it was read at, and holds there', () => {
		const store = inSession();
		store.setLoadUnit('lb');
		const stored = () => store.currentExercise?.sets[0]?.load ?? 0;

		store.bumpSet(0, 'load', 1);
		store.bumpSet(0, 'load', -1);
		const afterOneCycle = stored();

		for (let i = 0; i < 5; i++) {
			store.bumpSet(0, 'load', 1);
			store.bumpSet(0, 'load', -1);
		}

		expect(displayLoad(afterOneCycle, 'lb')).toBe(132.3);
		expect(stored()).toBe(afterOneCycle);
	});

	it('steps a prescribed load in the unit it is being read in too', () => {
		const store = withRoutine();
		store.setLoadUnit('lb');
		const shown = () => displayLoad(store.routine('full-body')?.exercises[0]?.load ?? 0, 'lb');
		// The template prescribes a 60 kg squat, which reads as 132.3 lb.
		expect(shown()).toBe(132.3);

		store.bumpRoutineExercise('full-body', 0, 'load', 1);

		expect(shown()).toBe(134.8);
	});

	// The preference is a load's, not a count's: a stepper that sent reps through
	// the load conversion would read 8 reps as 17.6 and step from there.
	it('steps reps as the count it is, whatever unit loads are read in', () => {
		const store = inSession();
		store.setLoadUnit('lb');

		store.bumpSet(0, 'reps', 1);

		expect(store.currentExercise?.sets[0]?.reps).toBe(9);
	});

	it('steps sets as the count they are, whatever unit loads are read in', () => {
		const store = withRoutine();
		store.setLoadUnit('lb');

		store.bumpRoutineExercise('full-body', 0, 'sets', 1);

		expect(store.routine('full-body')?.exercises[0]?.sets).toBe(4);
	});

	it('still stops a load at bodyweight when it is being read in pounds', () => {
		const store = inSession();
		store.setLoadUnit('lb');
		for (let i = 0; i < 100; i++) store.bumpSet(0, 'load', -1);
		expect(store.currentExercise?.sets[0]?.load).toBe(0);
	});

	it('moves the rest length within the range the control offers', async () => {
		const store = freshStore();
		store.setRestSeconds(120);
		expect(store.state.restSeconds).toBe(120);
		await vi.waitFor(() => expect(stored().restSeconds).toBe(120));
	});

	it('holds the rest length to the range rather than opening on nothing', () => {
		const store = freshStore();
		store.setRestSeconds(10);
		expect(store.state.restSeconds).toBe(30);
		store.setRestSeconds(600);
		expect(store.state.restSeconds).toBe(180);
		store.setRestSeconds(-5);
		expect(store.state.restSeconds).toBe(30);
	});

	it('keeps the rest length a whole number of seconds', () => {
		const store = freshStore();
		store.setRestSeconds(92.4);
		expect(store.state.restSeconds).toBe(92);
	});

	// Moved on a stepper, so it shares a save rather than serializing per tap.
	it('lets a burst of steps share one save', async () => {
		const store = freshStore();
		store.setRestSeconds(105);
		store.setRestSeconds(120);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		await vi.waitFor(() => expect(stored().restSeconds).toBe(120));
	});
});

describe('the units preference', () => {
	it('opens on metric', () => {
		const store = freshStore();
		expect(store.state.units).toBe('metric');
	});

	it('takes the other system and writes it down at once', () => {
		const store = freshStore();
		store.setUnits('imperial');
		expect(store.state.units).toBe('imperial');
		expect(stored().units).toBe('imperial');
		expect(reloaded().state.units).toBe('imperial');
	});

	it('gives an older payload lacking the field the metric default', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ onboarded: true, workouts: [] }));
		const store = new TendStore();
		store.hydrate();
		expect(store.state.units).toBe('metric');
	});

	it('rides along in a document taken from another device, unlike a load already logged', () => {
		const store = freshStore();
		store.replace({ onboarded: true, units: 'imperial' });
		expect(store.state.units).toBe('imperial');
	});

	it('is present in the persisted document so it syncs with the rest of the state', () => {
		const store = freshStore();
		store.setUnits('imperial');
		expect(Object.keys(stored())).toContain('units');
	});
});

describe('training across a reload', () => {
	it('saves each step of a session as it happens', () => {
		const store = inSession();
		expect(stored().activeWorkout?.routineName).toBe('Full body');
		store.toggleSet(0);
		store.flushPersist();
		expect(stored().activeWorkout?.exercises[0]?.sets[0]?.done).toBe(true);
		store.noteExercise('felt strong');
		store.flushPersist();
		expect(stored().activeWorkout?.exercises[0]?.note).toBe('felt strong');
		store.nextExercise();
		expect(stored().activeWorkout?.exerciseIndex).toBe(1);
		store.state.activeWorkout = null;
		store.persist();
		expect(stored().activeWorkout).toBeNull();
	});

	it('comes back to a session that was left mid-set', () => {
		const store = inSession();
		store.toggleSet(0);
		store.addSet();
		const next = reloaded();
		expect(next.state.activeWorkout?.exercises[0]?.sets).toHaveLength(4);
		expect(next.currentExercise?.sets[0]?.done).toBe(true);
	});

	it('comes back to the routines, the plan and the filed workouts', () => {
		const store = inSession();
		store.planDay('2026-01-07', 'full-body');
		store.toggleSet(0);
		store.finishWorkout();
		const next = reloaded();
		expect(next.state.routines).toHaveLength(1);
		expect(next.state.trainingPlan).toContainEqual({
			date: '2026-01-07',
			routineIds: ['full-body']
		});
		expect(next.state.workouts).toHaveLength(1);
		expect(next.state.activeWorkout).toBeNull();
	});
});

describe('saving a session without paying for it on every tap', () => {
	it('lets a burst of taps share one save, and makes it on its own', async () => {
		const store = inSession();
		store.toggleSet(0);
		store.bumpSet(0, 'load', 1);
		store.bumpSet(0, 'load', 1);
		// The taps have not each serialized the whole state on the way through.
		expect(stored().activeWorkout?.exercises[0]?.sets[0]?.done).toBe(false);
		await vi.waitFor(() => {
			expect(stored().activeWorkout?.exercises[0]?.sets[0]?.done).toBe(true);
			expect(stored().activeWorkout?.exercises[0]?.sets[0]?.load).toBe(65);
		});
	});

	it('writes what the last taps were holding before the session is filed', () => {
		const store = inSession();
		store.toggleSet(0);
		const filed = store.finishWorkout();
		expect(stored().workouts[0]?.id).toBe(filed?.id);
		expect(stored().workouts[0]?.exercises[0]?.sets[0]?.done).toBe(true);
		expect(stored().activeWorkout).toBeNull();
	});

	it('writes what the last taps were holding when the tab goes away', () => {
		const store = inSession();
		store.toggleSet(1);
		window.dispatchEvent(new Event('pagehide'));
		expect(stored().activeWorkout?.exercises[0]?.sets[1]?.done).toBe(true);
	});

	// A phone backgrounds a tab rather than closing it, and may never come back.
	it('writes what the last taps were holding when the tab goes into the background', () => {
		const store = inSession();
		store.toggleSet(1);
		setVisibility('hidden');
		window.dispatchEvent(new Event('visibilitychange'));
		expect(stored().activeWorkout?.exercises[0]?.sets[1]?.done).toBe(true);
	});

	it('holds the save while the tab is still on screen', () => {
		const store = inSession();
		store.toggleSet(1);
		setVisibility('visible');
		window.dispatchEvent(new Event('visibilitychange'));
		expect(stored().activeWorkout?.exercises[0]?.sets[1]?.done).toBe(false);
	});

	it('opens an added set at a default when the exercise has none to copy', () => {
		const store = inSession();
		const exercise = store.state.activeWorkout?.exercises[0];
		if (!exercise) throw new Error('the session opened without an exercise');
		exercise.sets = [];
		store.addSet();
		expect(exercise.sets).toEqual([{ reps: 10, load: 0, done: false }]);
	});

	it('comes back to a burst that was never flushed by hand', async () => {
		const store = inSession();
		store.toggleSet(0);
		store.toggleSet(2);
		await vi.waitFor(() => expect(stored().activeWorkout?.exercises[0]?.sets[2]?.done).toBe(true));
		const next = reloaded();
		expect(next.currentExercise?.sets.map((s) => s.done)).toEqual([true, false, true]);
	});
});

describe('debounced persistence internals', () => {
	it('does not schedule a debounced write before the store is hydrated', () => {
		const store = new TendStore();
		const routine = store.createRoutine();
		store.addExercises(routine.id, ['Deadlift']);
		store.bumpRoutineExercise(routine.id, 0, 'load', 1);
		// Hydrating afterward must not resurrect a write that was requested before it.
		store.hydrate();
		store.flushPersist();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('schedules only one debounced write for a burst of steps', async () => {
		const store = inSession();
		const spy = writeSpy();
		store.bumpSet(0, 'reps', 1);
		store.bumpSet(0, 'reps', 1);
		store.bumpSet(0, 'reps', 1);
		// Long enough for every timer a broken debounce would have left running to fire.
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	it('does nothing when flushed with no debounced write pending', () => {
		const store = onboarded();
		const spy = persistSpy();
		store.flushPersist();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('cancels a pending debounced write when persisted immediately', async () => {
		const store = inSession();
		const spy = writeSpy();
		store.bumpSet(0, 'reps', 1);
		store.persist();
		expect(spy).toHaveBeenCalledTimes(1);
		// If the debounced timer was not actually cancelled it fires here and writes again.
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	it('does not touch clearTimeout when there is no debounced write to cancel', () => {
		const store = onboarded();
		const spy = vi.spyOn(globalThis, 'clearTimeout');
		store.persist();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('binds the lifecycle flush listeners only once across repeated debounced writes', () => {
		const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
		const store = inSession();
		store.bumpSet(0, 'reps', 1);
		store.bumpSet(0, 'reps', 1);
		// One for `pagehide`, one for `visibilitychange` — never more, however many times it is asked.
		expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
		addEventListenerSpy.mockRestore();
	});

	it('does not touch addEventListener when it is not available', () => {
		const store = inSession();
		vi.stubGlobal('addEventListener', undefined);
		try {
			expect(() => store.toggleSet(0)).not.toThrow();
			expect(store.currentExercise?.sets[0]?.done).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('what a synced device needs from the store', () => {
	it('tells its watcher every time the document reaches storage', () => {
		const store = onboarded();
		const changes = vi.fn();
		store.watch(changes);
		store.togglePantry('oats');
		expect(changes).toHaveBeenCalledTimes(1);
	});

	it('tells it once for a burst that is written once', async () => {
		const store = inSession();
		const changes = vi.fn();
		store.watch(changes);
		store.bumpSet(0, 'reps', 1);
		store.bumpSet(0, 'reps', 1);
		await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
	});

	it('says nothing at all when nobody is watching', () => {
		const store = onboarded();
		expect(() => store.togglePantry('oats')).not.toThrow();
	});

	it('tells only the watcher that replaced the last one', () => {
		const store = onboarded();
		const first = vi.fn();
		const second = vi.fn();
		store.watch(first);
		store.watch(second);
		store.togglePantry('oats');
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('takes a document from elsewhere in place of its own', () => {
		const store = onboarded();
		store.replace({ onboarded: true, pantry: ['rice'], activeProfileId: 'p-9' });
		expect(store.state.pantry).toEqual(['rice']);
		expect(store.state.activeProfileId).toBe('p-9');
	});

	it('fills in every field the document it was given left out', () => {
		const store = onboarded();
		store.replace({ onboarded: true });
		expect(store.state.profiles).toEqual([]);
		expect(store.state.restSeconds).toBe(DEFAULT_REST_SECONDS);
	});

	it('writes what it took, so a reload finds it', () => {
		const store = onboarded();
		store.replace({ onboarded: true, pantry: ['rice'] });
		expect(stored().pantry).toEqual(['rice']);
	});

	it('drops a debounced write rather than letting it undo what it took', async () => {
		const store = inSession();
		store.toggleSet(0);
		store.replace({ onboarded: true, pantry: ['rice'] });
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(stored().pantry).toEqual(['rice']);
		expect(stored().activeWorkout).toBeNull();
	});

	it('does not report a document it took as a change of its own', () => {
		const store = onboarded();
		const changes = vi.fn();
		store.watch(changes);
		store.replace({ onboarded: true, pantry: ['rice'] });
		expect(changes).not.toHaveBeenCalled();
	});

	it('does not let a debounced write report the document it took, either', async () => {
		const store = inSession();
		// A debounced write is already scheduled when the server's answer lands.
		store.toggleSet(0);
		const changes = vi.fn();
		store.watch(changes);
		store.replace({ onboarded: true, pantry: ['rice'] });
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(changes).not.toHaveBeenCalled();
	});

	it('keeps nothing on the device once it is cleared', () => {
		const store = onboarded();
		store.clear();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(store.state.profiles).toEqual([]);
		expect(store.state.onboarded).toBe(false);
	});

	it('does not let a debounced write put the document back after it is cleared', async () => {
		const store = inSession();
		store.toggleSet(0);
		store.clear();
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('does not report being cleared as a change of its own', () => {
		const store = onboarded();
		const changes = vi.fn();
		store.watch(changes);
		store.clear();
		expect(changes).not.toHaveBeenCalled();
	});

	it('stays usable after being cleared, without hydrating again', () => {
		const store = onboarded();
		store.clear();
		store.togglePantry('oats');
		expect(stored().pantry).toEqual(['oats']);
	});

	it('clears where there is no browser storage at all', () => {
		const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
		try {
			const store = new TendStore();
			store.hydrate();
			expect(() => store.clear()).not.toThrow();
			expect(store.state.profiles).toEqual([]);
		} finally {
			if (real) Object.defineProperty(globalThis, 'localStorage', real);
		}
	});
});

describe('the version the stored document carries', () => {
	function rawDocument(): Record<string, unknown> {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) throw new Error('nothing was written to localStorage');
		return JSON.parse(raw) as Record<string, unknown>;
	}

	it('is written down, so whoever reads it next knows what shape it is', () => {
		onboarded();
		expect(rawDocument()['schemaVersion']).toBe(SCHEMA_VERSION);
	});

	it('comes back off the device as the state it was, with the version left behind', () => {
		const store = onboarded();
		store.togglePantry('oats');
		store.persist();

		const reread = new TendStore();
		reread.hydrate();

		expect(reread.state.pantry).toEqual(['oats']);
		expect(reread.refusal).toBeNull();
		expect(Object.keys(reread.state)).not.toContain('schemaVersion');
	});

	it('refuses a document written by a newer build, and does not write over it', () => {
		const newer = JSON.stringify({ ...emptyState(), schemaVersion: SCHEMA_VERSION + 1 });
		localStorage.setItem(STORAGE_KEY, newer);

		const store = new TendStore();
		store.hydrate();

		expect(store.refusal?.reason).toBe('future');
		expect(store.refusal?.message).toMatch(/update the app/i);
		// The one thing that must not happen: this build saving over data it
		// cannot read.
		store.togglePantry('oats');
		store.persist();
		expect(localStorage.getItem(STORAGE_KEY)).toBe(newer);
	});

	it('takes a document it can read in place of one it could not, and writes again', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...emptyState(), schemaVersion: SCHEMA_VERSION + 1 })
		);
		const store = new TendStore();
		store.hydrate();

		expect(store.replace({ ...emptyState(), pantry: ['rice'] })).toBe(true);

		expect(store.refusal).toBeNull();
		expect(store.state.pantry).toEqual(['rice']);
		expect(rawDocument()['pantry']).toEqual(['rice']);
	});

	// The rollback case: a newer build recorded something here, the app was
	// downgraded, and the account's copy is the older one this build can read.
	// Adopting it is right, and it is the only thing that gets the device working
	// again — but what it replaces is the only copy of the newer work.
	it('sets aside the document it could not read before writing over it', () => {
		const newer = JSON.stringify({
			...emptyState(),
			pantry: ['recorded on the newer build'],
			schemaVersion: SCHEMA_VERSION + 1
		});
		localStorage.setItem(STORAGE_KEY, newer);
		const store = new TendStore();
		store.hydrate();

		store.replace({ ...emptyState(), pantry: ['rice'] });

		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBe(newer);
	});

	it('sets aside a document it could not read for any other reason, too', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		const store = new TendStore();
		store.hydrate();

		store.replace({ ...emptyState(), pantry: ['rice'] });

		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBe('{not json');
	});

	it('sets nothing aside when there was nothing it could not read', () => {
		const store = onboarded();

		store.replace({ ...emptyState(), pantry: ['rice'] });

		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBeNull();
	});

	// The literal, not the constant: a renamed key would round-trip against itself
	// and the document set aside by an older build would be invisible.
	it('is set aside under the key the rest of the application knows', () => {
		expect(REFUSED_STORAGE_KEY).toBe('tend.v1.refused');
	});

	it('sets nothing aside when the document it refused is no longer there', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		const store = new TendStore();
		store.hydrate();
		// Another tab cleared the key between this device reading it and taking a
		// document in its place.
		localStorage.removeItem(STORAGE_KEY);

		store.replace({ ...emptyState(), pantry: ['rice'] });

		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBeNull();
	});

	it('sets nothing aside where there is no localStorage at all', () => {
		const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
		try {
			const store = new TendStore();
			store.hydrate();
			store.refusal = { ok: false, reason: 'future', message: 'newer than this build' };

			expect(() => store.replace({ ...emptyState(), pantry: ['rice'] })).not.toThrow();
		} finally {
			if (real) Object.defineProperty(globalThis, 'localStorage', real);
		}
	});

	it('signing out takes the document that was set aside with it', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...emptyState(), schemaVersion: SCHEMA_VERSION + 1 })
		);
		const store = new TendStore();
		store.hydrate();
		store.replace({ ...emptyState(), pantry: ['rice'] });
		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).not.toBeNull();

		store.clear();

		// It is this account's data; the next account signing in on this device
		// must not find it.
		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBeNull();
	});

	it('refuses a document from elsewhere that it cannot read, and keeps its own', () => {
		const store = onboarded();
		store.togglePantry('oats');
		store.persist();

		expect(store.replace({ ...emptyState(), schemaVersion: SCHEMA_VERSION + 1 })).toBe(false);
		expect(store.replace({ onboarded: true, restSeconds: 'ninety' })).toBe(false);

		expect(store.state.pantry).toEqual(['oats']);
		expect(rawDocument()['pantry']).toEqual(['oats']);
	});

	it('signing out clears a refusal along with everything else', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...emptyState(), schemaVersion: SCHEMA_VERSION + 1 })
		);
		const store = new TendStore();
		store.hydrate();

		store.clear();

		expect(store.refusal).toBeNull();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});

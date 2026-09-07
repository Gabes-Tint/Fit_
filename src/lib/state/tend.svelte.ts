import { buildAlexProfile, buildJordanProfile, HOUSEHOLD_PARTNER } from '$lib/domain/demo-seed';
import { ROUTINE_TEMPLATES } from '$lib/domain/exercise-catalog';
import {
	bumpField,
	exercisesFromLibrary,
	routinesFromTemplate,
	emptyRoutine,
	type BumpField
} from '$lib/domain/exercises';
import { toggleRoutineOn, withoutRoutine } from '$lib/domain/planned-days';
import { SEED_FOOD_BY_ID, scaleFood } from '$lib/domain/foods';
import { emptyProfile } from '$lib/domain/profile';
import type {
	Injection,
	LoadUnit,
	LogItem,
	PlannedMealSlot,
	Profile,
	Routine,
	RoutineExercise,
	TendState,
	UnitSystem,
	WeightEntry,
	Workout,
	WorkoutSet
} from '$lib/domain/types';
import { MAX_REST_SECONDS, MIN_REST_SECONDS } from '$lib/domain/types';
import {
	emptyState,
	parseStateDocument,
	loadStateDocument,
	storedDocument,
	type LoadRefusal
} from '$lib/domain/state-document';
import { round1, todayISO, uid } from '$lib/domain/utils';
import { currentExercise, workoutFromRoutine } from '$lib/domain/workout';
import { buildWeekPlan, mealPool } from '$lib/domain/week-plan';

export const STORAGE_KEY = 'tend.v1';

/**
 * Where a document this build could not read is set aside when a readable one
 * takes its place.
 *
 * The case is a rollback: a newer build wrote this device's document, the app
 * was then downgraded — a web deploy rolled back, an Android version reinstalled
 * — and the account's copy on the server is the older one this build can read.
 * Adopting that is right, and it is the only thing that gets the device working
 * again; but the document being replaced is the only copy of whatever was
 * recorded on the newer build, so it is kept rather than dropped. Not read back
 * automatically: this build could not read it when it refused it, and cannot
 * once it has been superseded either. It is there to be recovered from, by hand
 * or by the newer build being reinstalled, and it is removed on sign-out with
 * everything else.
 */
export const REFUSED_STORAGE_KEY = 'tend.v1.refused';

// A held stepper shares one save; a tab closed a moment later still makes it.
const PERSIST_WINDOW_MS = 200;

function rescale(item: LogItem, servings: number): LogItem {
	const source = item.foodId ? SEED_FOOD_BY_ID[item.foodId] : undefined;
	if (!source) {
		const ratio = item.servings === 0 ? 1 : servings / item.servings;
		return {
			...item,
			servings,
			kcal: Math.round(item.kcal * ratio),
			protein: round1(item.protein * ratio),
			carbs: round1(item.carbs * ratio),
			fat: round1(item.fat * ratio),
			micros: Object.fromEntries(
				Object.entries(item.micros).map(([k, v]) => [k, round1(v * ratio)])
			) as LogItem['micros']
		};
	}
	return { ...item, servings, ...scaleFood(source, servings) };
}

/**
 * The whole application state, as a rune-backed singleton. `hydrate()` is
 * explicit so a server render never touches `localStorage`; `hydrated` stays
 * false until it runs. Interim home for the data until the SQLite backend lands.
 */
export class TendStore {
	state = $state<TendState>(emptyState());
	hydrated = $state(false);

	/**
	 * Why the stored document was not loaded, and `null` when there was nothing
	 * to refuse. Set only by `hydrate()` and cleared by taking a document this
	 * build can read, or by `clear()`. While it is set this store writes
	 * nothing: what is on the device is newer or stranger than anything in
	 * memory, and overwriting it is the one unrecoverable move.
	 */
	refusal = $state<LoadRefusal | null>(null);

	private pendingWrite: ReturnType<typeof setTimeout> | null = null;
	private lifecycleFlushBound = false;
	private onWrite: (() => void) | null = null;

	get profile(): Profile | null {
		return this.state.profiles.find((p) => p.id === this.state.activeProfileId) ?? null;
	}

	// -- persistence ---------------------------------------------------------

	/**
	 * Read what this device has stored. A document from an older build comes up
	 * the ladder; one this build cannot read is refused rather than guessed at,
	 * and a refusal leaves the stored text exactly where it is — `write()` stops
	 * while `refusal` is set, so an empty document can never be saved over data
	 * this build merely failed to understand.
	 */
	hydrate() {
		if (this.hydrated) return;
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (raw) {
			const loaded = parseStateDocument(raw);
			if (loaded.ok) {
				this.state = loaded.state;
			} else {
				this.refusal = loaded;
			}
		}
		this.hydrated = true;
	}

	persist() {
		this.cancelPendingWrite();
		this.write();
	}

	// A ceiling, not a reset: a held stepper still reaches storage while held.
	private persistSoon() {
		if (!this.hydrated) return;
		this.bindLifecycleFlush();
		if (this.pendingWrite !== null) return;
		this.pendingWrite = setTimeout(() => {
			this.pendingWrite = null;
			this.write();
		}, PERSIST_WINDOW_MS);
	}

	flushPersist() {
		if (this.pendingWrite === null) return;
		this.persist();
	}

	private write() {
		if (!this.hydrated) return;
		// Never over a document this build could not read: see `refusal`.
		if (this.refusal !== null) return;
		const document = storedDocument($state.snapshot(this.state));
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(document));
		this.onWrite?.();
	}

	/**
	 * Be told whenever the document changes, which `write()` above is the one
	 * funnel for. `sync.svelte.ts` uses it as the signal to push, in preference
	 * to an effect over a snapshot of `state`: an effect outside a component
	 * needs its own root, only runs at all in a client build, and would deep-clone
	 * the whole document on every keystroke to notice what this already knows.
	 *
	 * `replace()` and `clear()` below are deliberately silent. They are the sync
	 * module putting the server's answer into the store, and reporting those back
	 * to it as local changes would push a document straight back where it came
	 * from.
	 */
	watch(listener: () => void) {
		this.onWrite = listener;
	}

	/**
	 * Take a document from the server in place of this device's, and say whether
	 * it was taken. It goes up the ladder exactly as `hydrate()`'s does, so a
	 * document written by an older build arrives complete; one this build cannot
	 * read changes nothing at all and answers `false`, leaving the caller to
	 * decide what to say about it. Any debounced write still pending is dropped
	 * rather than allowed to undo what was just taken.
	 */
	replace(document: unknown): boolean {
		const loaded = loadStateDocument(document);
		if (!loaded.ok) return false;
		this.cancelPendingWrite();
		this.setAside();
		// A document this build can read supersedes whatever this device failed
		// to read on its own, so the store is writable again.
		this.refusal = null;
		this.state = loaded.state;
		this.writeSilently();
		return true;
	}

	/**
	 * Keep the document this build refused, before something readable is written
	 * where it was. See `REFUSED_STORAGE_KEY`. Any refusal is kept, not only a
	 * document from a newer build: the reason this build could not read it does
	 * not change that the text about to be overwritten is the only copy.
	 */
	private setAside(): void {
		const storage = globalThis.localStorage;
		if (this.refusal === null || storage === undefined) return;
		const raw = storage.getItem(STORAGE_KEY);
		if (typeof raw === 'string') storage.setItem(REFUSED_STORAGE_KEY, raw);
	}

	/**
	 * Keep nothing. Signing out empties the device, so the key is removed rather
	 * than overwritten with an empty document — `resetAll()` leaves one behind,
	 * and a leftover document is what the next account would find.
	 */
	clear() {
		this.cancelPendingWrite();
		this.refusal = null;
		this.state = emptyState();
		globalThis.localStorage?.removeItem(STORAGE_KEY);
		// A document set aside is still this account's data, and leaving it for
		// whoever signs in next is exactly what this method exists to prevent.
		globalThis.localStorage?.removeItem(REFUSED_STORAGE_KEY);
	}

	/** `write()` without the notification: see `watch()`. */
	private writeSilently() {
		const listener = this.onWrite;
		this.onWrite = null;
		this.write();
		this.onWrite = listener;
	}

	private cancelPendingWrite() {
		if (this.pendingWrite === null) return;
		clearTimeout(this.pendingWrite);
		this.pendingWrite = null;
	}

	// `pagehide` and `visibilitychange` are the last reliable moments before a mobile browser kills a tab.
	private bindLifecycleFlush() {
		if (this.lifecycleFlushBound) return;
		if (typeof globalThis.addEventListener !== 'function') return;
		this.lifecycleFlushBound = true;
		globalThis.addEventListener('pagehide', () => this.flushPersist());
		globalThis.addEventListener('visibilitychange', () => {
			if (globalThis.document.visibilityState === 'hidden') this.flushPersist();
		});
	}

	// -- profiles ------------------------------------------------------------

	completeOnboarding(args: { profile: Profile; household: boolean; useSample: boolean }) {
		const { profile, household, useSample } = args;
		// A non-empty tuple: onboarding always produces the person doing it, so the
		// active profile below is a member rather than a maybe.
		let profiles: [Profile, ...Profile[]];
		if (useSample) {
			const seeded = buildAlexProfile();
			profiles = [
				{
					...seeded,
					name: profile.name || 'Alex',
					goal: profile.goal,
					glp1: profile.glp1,
					sex: profile.sex,
					age: profile.age,
					heightCm: profile.heightCm,
					activity: profile.activity,
					restrictions: profile.restrictions
				}
			];
			if (household) profiles.push(buildJordanProfile());
		} else {
			profiles = [emptyProfile(profile)];
			if (household) {
				profiles.push(
					emptyProfile({ ...HOUSEHOLD_PARTNER, restrictions: [...HOUSEHOLD_PARTNER.restrictions] })
				);
			}
		}
		this.state.onboarded = true;
		this.state.profiles = profiles;
		this.state.activeProfileId = profiles[0].id;
		// `generatePlan()` builds the week plan from scratch, so there is nothing to clear first.
		// `persist()` is explicit here so onboarding does not silently depend on `generatePlan` doing it.
		this.generatePlan();
		this.persist();
	}

	patchActive(fn: (p: Profile) => Profile) {
		this.state.profiles = this.state.profiles.map((p) =>
			p.id === this.state.activeProfileId ? fn($state.snapshot(p)) : p
		);
		this.persist();
	}

	// -- log -----------------------------------------------------------------

	addLogItems(items: LogItem[]) {
		const active = this.profile;
		if (!active) return;
		active.log.push(...items);
		this.persist();
	}

	updateLog(id: string, patch: Partial<LogItem>) {
		const active = this.profile;
		if (!active) return;
		active.log = active.log.map((item) => {
			if (item.id !== id) return item;
			const current: LogItem = $state.snapshot(item);
			// Rescale from the current entry: patching first would make the ratio 1 and a custom entry would never move.
			if (patch.servings != null && patch.servings !== current.servings) {
				return { ...rescale(current, patch.servings), ...patch };
			}
			return { ...current, ...patch };
		});
		this.persist();
	}

	removeLog(id: string) {
		const active = this.profile;
		if (!active) return;
		active.log = active.log.filter((i) => i.id !== id);
		this.persist();
	}

	// -- measurements --------------------------------------------------------

	addWeight(kg: number, date?: string) {
		const active = this.profile;
		if (!active) return;
		const d = date ?? todayISO();
		const entry: WeightEntry = { id: uid('w-'), date: d, kg };
		// One reading per day: a re-weigh replaces so the TDEE regression is not skewed by a noisy morning.
		active.weights = [...active.weights.filter((w) => w.date !== d), entry].sort((a, b) =>
			a.date.localeCompare(b.date)
		);
		this.persist();
	}

	addInjection(inj: Omit<Injection, 'id'>) {
		const active = this.profile;
		if (!active) return;
		active.injections.push({ ...inj, id: uid('i-') });
		this.persist();
	}

	// -- plan ----------------------------------------------------------------

	generatePlan() {
		this.state.weekPlan = buildWeekPlan({ profiles: this.state.profiles, today: todayISO() });
		this.persist();
	}

	swapPlanned(date: string, meal: PlannedMealSlot) {
		const current = this.state.weekPlan.find((p) => p.date === date && p.meal === meal);
		const pool = mealPool(this.state.profiles, meal);
		// Step to the next fit, not the head: always taking the first would alternate between two.
		const pick = pool[(pool.findIndex((r) => r.id === current?.recipeId) + 1) % pool.length];
		if (!pick || pick.id === current?.recipeId) return;
		this.state.weekPlan = this.state.weekPlan.map((p) =>
			p.date === date && p.meal === meal ? { ...p, recipeId: pick.id } : p
		);
		this.persist();
	}

	togglePantry(foodId: string) {
		this.state.pantry = this.state.pantry.includes(foodId)
			? this.state.pantry.filter((id) => id !== foodId)
			: [...this.state.pantry, foodId];
		this.persist();
	}

	// -- training ------------------------------------------------------------

	routine(id: string): Routine | undefined {
		return this.state.routines.find((r) => r.id === id);
	}

	/**
	 * Takes the rotation, and the plan that pointed at the old one goes with it —
	 * those routines no longer exist. Which days the new ones land on is the
	 * person's to choose in the week view; the app used to guess it from a
	 * frequency, and guessing is what this replaced.
	 */
	useTemplate(templateId: string) {
		const template = ROUTINE_TEMPLATES.find((t) => t.id === templateId);
		if (!template) return;
		this.state.routines = routinesFromTemplate(template);
		this.state.trainingPlan = [];
		this.persist();
	}

	createRoutine(): Routine {
		const routine = emptyRoutine(uid('r-'));
		this.state.routines.push(routine);
		this.persist();
		return routine;
	}

	updateRoutine(id: string, patch: Partial<Pick<Routine, 'name'>>) {
		this.state.routines = this.state.routines.map((r) => (r.id === id ? { ...r, ...patch } : r));
		this.persist();
	}

	removeRoutine(id: string) {
		this.state.routines = this.state.routines.filter((r) => r.id !== id);
		this.state.trainingPlan = withoutRoutine(this.state.trainingPlan, id);
		this.persist();
	}

	// Write the field in place: rebuilding would give every row a new identity and rerender the whole sheet.
	bumpRoutineExercise(id: string, index: number, field: BumpField, direction: number) {
		const exercise = this.routine(id)?.exercises[index];
		if (!exercise) return;
		exercise[field] = bumpField(field, exercise[field], direction);
		this.persistSoon();
	}

	addExercises(id: string, names: string[]) {
		const routine = this.routine(id);
		const added = exercisesFromLibrary(names);
		if (!routine || added.length === 0) return;
		routine.exercises.push(...added);
		this.persist();
	}

	removeExercise(id: string, index: number) {
		const routine = this.routine(id);
		if (!routine || !routine.exercises[index]) return;
		routine.exercises.splice(index, 1);
		this.persist();
	}

	moveExerciseUp(id: string, index: number) {
		if (index <= 0) return;
		const exercises = this.routine(id)?.exercises;
		if (!exercises?.[index]) return;
		// The bounds check above guarantees `splice` removes exactly the checked row.
		const [moved] = exercises.splice(index, 1) as [RoutineExercise];
		exercises.splice(index - 1, 0, moved);
		this.persist();
	}

	// -- training plan -------------------------------------------------------

	/** One tap in the week view: the routine goes on the day, or comes back off it. */
	planDay(date: string, routineId: string) {
		this.state.trainingPlan = toggleRoutineOn(this.state.trainingPlan, date, routineId);
		this.persist();
	}

	// -- training settings ---------------------------------------------------

	// The unit is a label, not a conversion: converting would rewrite the log on every look.
	setLoadUnit(unit: LoadUnit) {
		this.state.loadUnit = unit;
		this.persist();
	}

	// Clamped to the control's range; saved through the debounce because it is a stepper.
	setRestSeconds(seconds: number) {
		this.state.restSeconds = Math.min(
			MAX_REST_SECONDS,
			Math.max(MIN_REST_SECONDS, Math.round(seconds))
		);
		this.persistSoon();
	}

	// -- preferences -----------------------------------------------------------

	// The system is a display choice, not a conversion: nothing stored is rewritten.
	setUnits(units: UnitSystem) {
		this.state.units = units;
		this.persist();
	}

	// -- workouts ------------------------------------------------------------

	startWorkout(routineId: string): Workout | null {
		const routine = this.routine(routineId);
		if (!routine) return null;
		if (routine.exercises.length === 0) return null;
		const workout = workoutFromRoutine(routine, {
			id: uid('w-'),
			date: todayISO(),
			startedAt: Date.now()
		});
		this.state.activeWorkout = workout;
		this.persist();
		return workout;
	}

	// Returns the live object, not a copy: a rebuild would give every set a new identity on each tick.
	private get liveExercise(): Workout['exercises'][number] | null {
		const workout = this.state.activeWorkout;
		if (!workout) return null;
		return workout.exercises[workout.exerciseIndex] ?? null;
	}

	toggleSet(index: number) {
		const set = this.liveExercise?.sets[index];
		if (!set) return;
		set.done = !set.done;
		this.persistSoon();
	}

	bumpSet(index: number, field: 'reps' | 'load', direction: number) {
		const set = this.liveExercise?.sets[index];
		if (!set) return;
		set[field] = bumpField(field, set[field], direction);
		this.persistSoon();
	}

	addSet() {
		const exercise = this.liveExercise;
		if (!exercise) return;
		// Only reps and load carry over; the pushed set below always starts undone.
		const last: Pick<WorkoutSet, 'reps' | 'load'> = exercise.sets.at(-1) ?? { reps: 10, load: 0 };
		exercise.sets.push({ reps: last.reps, load: last.load, done: false });
		this.persist();
	}

	noteExercise(note: string) {
		const exercise = this.liveExercise;
		if (!exercise) return;
		exercise.note = note;
		this.persistSoon();
	}

	swapExercise(name: string) {
		const replacement = exercisesFromLibrary([name])[0];
		const exercise = this.liveExercise;
		if (!replacement || !exercise) return;
		exercise.name = replacement.name;
		exercise.group = replacement.group;
		this.persist();
	}

	nextExercise() {
		const workout = this.state.activeWorkout;
		if (!workout) return;
		workout.exerciseIndex = Math.min(workout.exercises.length - 1, workout.exerciseIndex + 1);
		this.persist();
	}

	// An empty session is still filed; aggregates read through ticked sets, so it draws no point.
	finishWorkout(): Workout | null {
		const current = this.state.activeWorkout;
		if (!current) return null;
		const finished: Workout = { ...$state.snapshot(current), finishedAt: Date.now() };
		this.state.workouts.push(finished);
		this.state.activeWorkout = null;
		this.persist();
		return finished;
	}

	get currentExercise() {
		const workout = this.state.activeWorkout;
		return workout ? (currentExercise(workout) ?? null) : null;
	}

	// -- whole-state ---------------------------------------------------------

	resetAll() {
		this.state = emptyState();
		this.hydrated = true;
		this.persist();
	}
}

export const tend = new TendStore();

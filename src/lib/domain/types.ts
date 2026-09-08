import type { Portion } from './portions';

export type Provenance = 'usda' | 'off' | 'lab' | 'brand' | 'community';

/** Every meal a log entry can belong to, in the order the interface offers them. */
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export type Meal = (typeof MEALS)[number];

/** The meals the week plan fills. Snacks are logged, never planned. */
export const PLANNED_MEALS = ['breakfast', 'lunch', 'dinner'] as const satisfies readonly Meal[];

export type PlannedMealSlot = (typeof PLANNED_MEALS)[number];

export type Goal = 'lose' | 'maintain' | 'gain' | 'glp1';

export type Activity = 'sedentary' | 'light' | 'moderate' | 'active';

export type Restriction =
	| 'vegetarian'
	| 'vegan'
	| 'gluten-free'
	| 'dairy-free'
	| 'nut-free'
	| 'no-pork'
	| 'low-sodium'
	| 'high-protein';

export type Micros = {
	fiber: number;
	sugar: number;
	sodium: number;
	potassium: number;
	iron: number;
	calcium: number;
	magnesium: number;
	zinc: number;
	vitaminA: number;
	vitaminC: number;
	vitaminD: number;
	vitaminB12: number;
	folate: number;
};

/** Zeroed `Micros`; adding a field to the type fails here until a value is given. */
export const ZERO_MICROS: Micros = {
	fiber: 0,
	sugar: 0,
	sodium: 0,
	potassium: 0,
	iron: 0,
	calcium: 0,
	magnesium: 0,
	zinc: 0,
	vitaminA: 0,
	vitaminC: 0,
	vitaminD: 0,
	vitaminB12: 0,
	folate: 0
};

/**
 * A food's nutrients per 100 g/mL, the basis the catalog stores them on,
 * before they are scaled onto a serving. Unlike `Micros`, a value the source
 * never reported stays `null` here rather than becoming zero — the nutrition
 * facts sheet (#175) needs that distinction to show an em dash instead of a
 * false zero. `folate` is on `Micros` but not here: nothing yet reads it off
 * the wire, so it stays out of this basis until something does.
 */
export type NutrientBasis = {
	kcal: number;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
	saturatedFat: number | null;
	fiber: number | null;
	sugar: number | null;
	sodium: number | null;
	/**
	 * Optional, unlike the fields above: they were on the wire before #175 and
	 * every fixture in the tree sets them, so they stay required. These nine
	 * are new — a payload that omits them entirely (every fixture written
	 * before this change) is still a valid one, read the same as `null`.
	 */
	potassium?: number | null | undefined;
	iron?: number | null | undefined;
	calcium?: number | null | undefined;
	magnesium?: number | null | undefined;
	zinc?: number | null | undefined;
	vitaminA?: number | null | undefined;
	vitaminC?: number | null | undefined;
	vitaminD?: number | null | undefined;
	vitaminB12?: number | null | undefined;
};

export type Food = {
	id: string;
	name: string;
	brand?: string | undefined;
	aliases: string[];
	barcode?: string | undefined;
	category: string;
	provenance: Provenance;
	servingLabel: string;
	grams: number;
	/**
	 * What one of each household measure weighs for this food, when the catalog
	 * says. A tablespoon of oil is 13.5 g and a tablespoon of flour 8 g, so this
	 * is per food and never a constant; absent means the catalog did not say.
	 */
	portions?: readonly Portion[] | undefined;
	/**
	 * What one countable unit of this food weighs — a Big Mac, a cookie —
	 * when the catalog named one (#178). Absent for anything the catalog
	 * could only weigh or measure by volume, milk included.
	 */
	unit?: { label: string; grams: number } | undefined;
	kcal: number;
	protein: number;
	carbs: number;
	fat: number;
	micros: Micros;
	/**
	 * The raw per-100 g basis a catalog row carried, nulls and all. Absent for
	 * a bundled food, which never had one — `nutritionFactsRows` falls back to
	 * this food's own already-scaled numbers in that case (#175).
	 */
	per100g?: NutrientBasis | undefined;
};

/**
 * What the sample journal and the recipe book need to know about a food: enough
 * to put a number on a plate, and nothing that would let it be searched. A
 * catalog `Food` satisfies it, so `scaleFood` takes either.
 */
export type SeedFood = Pick<
	Food,
	| 'id'
	| 'name'
	| 'brand'
	| 'category'
	| 'provenance'
	| 'servingLabel'
	| 'kcal'
	| 'protein'
	| 'carbs'
	| 'fat'
	| 'micros'
>;

export type LogSource = 'manual' | 'text' | 'photo' | 'voice' | 'barcode' | 'plan';

export type LogItem = {
	id: string;
	foodId: string | null;
	date: string;
	meal: Meal;
	servings: number;
	source: LogSource;
	note?: string | undefined;
	name: string;
	kcal: number;
	protein: number;
	carbs: number;
	fat: number;
	micros: Micros;
	provenance?: Provenance | undefined;
	servingLabel: string;
	brand?: string | undefined;
};

export type WeightEntry = {
	id: string;
	date: string;
	kg: number;
};

export type Injection = {
	id: string;
	date: string;
	medication: 'semaglutide' | 'tirzepatide' | 'liraglutide' | 'other';
	doseMg: number;
	site: 'abdomen' | 'thigh' | 'arm';
	appetite: 1 | 2 | 3 | 4 | 5;
	sideEffects: string[];
	notes: string;
};

export type Profile = {
	id: string;
	name: string;
	goal: Goal;
	glp1: boolean;
	sex: 'female' | 'male' | 'other';
	age: number;
	heightCm: number;
	activity: Activity;
	restrictions: Restriction[];
	log: LogItem[];
	weights: WeightEntry[];
	injections: Injection[];
	calorieOverride: number | null;
	proteinOverride: number | null;
	fiberOverride: number | null;
};

export type PlannedMeal = {
	date: string;
	meal: PlannedMealSlot;
	recipeId: string;
	forProfileIds: string[];
};

export type ProposedItem = {
	foodId: string | null;
	query: string;
	name: string;
	servings: number;
	meal: Meal;
	confidence: number;
	note?: string | undefined;
};

// -- training -----------------------------------------------------------------

/** The muscle groups the exercise library is filed under, in menu order. */
export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs'] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export type LibraryExercise = {
	name: string;
	group: MuscleGroup;
};

/**
 * The units a load can be read in. Which one is on show is `TendState.loadUnit`;
 * what is stored underneath is always kilograms.
 */
export type LoadUnit = 'kg' | 'lb';

export const DEFAULT_LOAD_UNIT: LoadUnit = 'kg';

/** The unit system quantities are read in. Which one is on show is `TendState.units`. */
export type UnitSystem = 'metric' | 'imperial';

export const DEFAULT_UNITS: UnitSystem = 'metric';

/** Rest between sets, in seconds: the default, and its lower and upper bounds. */
export const DEFAULT_REST_SECONDS = 90;
export const MIN_REST_SECONDS = 30;
export const MAX_REST_SECONDS = 180;

/** One movement as a routine prescribes it: how many sets, at what reps and load. */
export type RoutineExercise = LibraryExercise & {
	sets: number;
	reps: number;
	/**
	 * The load on the bar, in kilograms, whatever `loadUnit` is set to. A load is
	 * a mass and is stored like every other mass here, so the number survives a
	 * change of unit unchanged in meaning; `units.ts` converts it for reading and
	 * for what somebody steps. Zero means bodyweight and reads as an em dash.
	 */
	load: number;
};

/**
 * A session's worth of movements, and nothing about when it runs: a routine is
 * a template, and which days it lands on is planned per day in `trainingPlan`.
 */
export type Routine = {
	id: string;
	name: string;
	exercises: RoutineExercise[];
	/**
	 * The day the routine was deleted, or `null` while it is still in the
	 * rotation. Deletion is a flag rather than a removal because past planned
	 * days are the denominator of adherence and still have to name the routine
	 * they asked for: taking the row out would quietly raise the score for
	 * sessions that were missed.
	 */
	deletedAt: string | null;
};

/** One set as it was actually performed, which is why `done` lives here and not on the routine. */
export type WorkoutSet = {
	reps: number;
	/** What was on the bar, in kilograms, on the same terms as `RoutineExercise.load`. */
	load: number;
	done: boolean;
};

export type WorkoutExercise = {
	name: string;
	group: MuscleGroup;
	sets: WorkoutSet[];
	note: string;
};

/**
 * One trip to the gym, copied from the routine at start rather than referenced,
 * so editing a routine later does not rewrite what was lifted.
 */
export type Workout = {
	id: string;
	routineId: string;
	routineName: string;
	date: string;
	/** Epoch milliseconds, so elapsed time survives a reload rather than being counted in memory. */
	startedAt: number;
	finishedAt: number | null;
	exerciseIndex: number;
	exercises: WorkoutExercise[];
};

/**
 * The routines one calendar day holds. A date with no entry is a rest day, so
 * rest is the absence of a plan rather than a value the plan carries — which is
 * why there is no id standing in for "nothing".
 */
export type PlannedDay = {
	/** ISO `YYYY-MM-DD`. */
	date: string;
	/** Routine ids in the order they are meant to be trained: the lift, then the run. */
	routineIds: string[];
};

export type TendState = {
	onboarded: boolean;
	activeProfileId: string;
	profiles: Profile[];
	weekPlan: PlannedMeal[];
	pantry: string[];
	/**
	 * Training is per-household, not per-profile: the gym log belongs to whoever
	 * lifts, unlike meals, which are shared.
	 */
	routines: Routine[];
	trainingPlan: PlannedDay[];
	/** Finished workouts, oldest first. The unfinished one is `activeWorkout`. */
	workouts: Workout[];
	activeWorkout: Workout | null;
	/**
	 * The unit loads are read in. Switching it rewrites nothing, because there is
	 * nothing to rewrite: every load is stored in kilograms and converted on the
	 * way to the screen, so the same mass simply reads as 100 kg or as 220.5 lb.
	 * It was not always so — before schema version 4 a load was the bare number
	 * on the bar and this preference decided what that number meant, which made
	 * flipping it silently reinterpret every session ever logged.
	 */
	loadUnit: LoadUnit;
	/** How long the rest between sets runs, in seconds. */
	restSeconds: number;
	/**
	 * The system everything outside the gym is read in: body weight, height.
	 * Conversion happens only at display — body weight stays `kg`, height stays
	 * `heightCm`, regardless of this. Loads have their own preference in
	 * `loadUnit`, since thinking in kilos on the bar and pounds on the scale is a
	 * perfectly ordinary way to live.
	 */
	units: UnitSystem;
};

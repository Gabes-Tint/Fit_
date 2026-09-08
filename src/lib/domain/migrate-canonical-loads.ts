/**
 * Rung 3 → 4: a load becomes a mass rather than a number standing next to a label.
 *
 * Version 3 stored `RoutineExercise.load` and `WorkoutSet.load` as the bare
 * number on the bar and left `loadUnit` to say what that number meant. Nothing
 * ever converted, so flipping the unit turned a 100 kg squat into a 100 lb squat
 * without moving a digit: every personal record, load trend and volume total was
 * reinterpreted and nobody was told. Version 4 stores every load in kilograms,
 * the way body weight and height are already stored, and converts only where a
 * load is read or written.
 *
 * That leaves one question this rung has to answer: what the numbers already
 * written mean. They are read as being in the account's current `loadUnit`,
 * because that is the unit whose label the person was looking at when they typed
 * the number — the only reading the document actually supports. So a metric
 * account is a pure no-op, its numbers being kilograms already, and an imperial
 * one has every load multiplied by the pounds-to-kilograms factor.
 *
 * `loadUnit` itself stays exactly where it is. It is still the preference, and
 * after this rung it is honestly what it always claimed to be: the unit the
 * readouts are converted into, with nothing stored depending on it.
 *
 * The factor is written out below rather than imported from `units.ts`, for the
 * same reason version 1's week arithmetic is written out in its own rung: a rung
 * means what it meant on the day it shipped, so a later change to how the app
 * converts a mass must not reach back and move loads this rung already wrote.
 */

type Document = Record<string, unknown>;

/** The shape this rung produces. */
const VERSION_4 = 4;

/** Kilograms in one pound: exact, by international agreement. */
const KG_PER_LB = 0.45359237;

/**
 * `mapper` over a nested object, or over each one in a list of them. Anything
 * that is neither is handed back as it came: this rung has no more right to
 * repair a malformed document than the shape check that will refuse it a moment
 * later, and a `routines` that is not a list has to reach that check intact.
 */
function converted(value: unknown, mapper: (row: Document) => Document): unknown {
	if (Array.isArray(value)) return value.map((row) => converted(row, mapper));
	return value !== null && typeof value === 'object' ? mapper(value as Document) : value;
}

/**
 * A row carrying a load — a routine's exercise, or a workout's set — with that
 * load written in kilograms.
 *
 * Nothing is rounded on the way in. The factor is exact, so the product is the
 * pound reading to within the last bit of a double, and the reading is rounded
 * back to one decimal at display (`units.ts`, `displayLoad`) — one decimal being
 * the precision a load is entered at, since the stepper moves it by 2.5 and no
 * write path produces more. That is what makes the upgrade invisible to whoever
 * ran it: a 137.5 lb bench comes back as 137.5 lb, not as 137.4. Rounding the
 * kilograms here would throw away precision the next conversion needs and buy
 * nothing.
 *
 * Zero is bodyweight rather than a mass and stays exactly zero. A row with no
 * load, or one whose load is not a finite number, is handed back as it came —
 * the row itself, not a copy of it, so nothing is rewritten with a field it
 * never had. `Number.isFinite` is the whole test: it is false for a load that
 * was never a number and false for a NaN or an infinity that once was one, so
 * the cast below is reading a check that has already been made.
 */
function loadInKilograms(row: Document): Document {
	const load = row['load'];
	if (!Number.isFinite(load) || load === 0) return row;
	return { ...row, load: (load as number) * KG_PER_LB };
}

function routineInKilograms(routine: Document): Document {
	return { ...routine, exercises: converted(routine['exercises'], loadInKilograms) };
}

function workoutInKilograms(workout: Document): Document {
	const exercises = converted(workout['exercises'], (exercise) => ({
		...exercise,
		sets: converted(exercise['sets'], loadInKilograms)
	}));
	return { ...workout, exercises };
}

/**
 * The rung itself. `activeWorkout` is a field of its own rather than a member of
 * `workouts`, so it is named separately: missing it would leave the set somebody
 * is standing over reading in the wrong unit while the sets behind it read right.
 */
export function migrate_3_to_4(document: Document): Document {
	// A conversion is the one thing a rung must never do twice: applied to its own
	// output it would convert already-canonical kilograms a second time and halve
	// every load, which is the silent rewriting this rung exists to end. The ladder
	// applies each rung exactly once, keyed on the version the document declares;
	// reading that same key here means the guarantee does not rest on the caller.
	if (document['schemaVersion'] === VERSION_4) return document;
	const upgraded = { ...document, schemaVersion: VERSION_4 };
	// Metric accounts wrote kilograms all along. Nothing to convert, and nothing
	// to round-trip through a multiplication that could only lose a digit.
	if (document['loadUnit'] !== 'lb') return upgraded;
	return {
		...upgraded,
		routines: converted(document['routines'], routineInKilograms),
		workouts: converted(document['workouts'], workoutInKilograms),
		activeWorkout: converted(document['activeWorkout'], workoutInKilograms)
	};
}

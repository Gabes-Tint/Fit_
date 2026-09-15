/**
 * Rung 5 → 6: the session note belongs to the workout, not to each exercise.
 *
 * Version 5 kept a free-text `note` on every `WorkoutExercise`, so a session
 * that felt heavy throughout had to say so under one movement and hope it was
 * read as being about the rest. Version 6 keeps one `note` on the `Workout`.
 *
 * The notes already written are not thrown away. Each workout — every filed one
 * and the one in progress — has its exercises' non-empty notes collected in
 * routine order, one per line as `Exercise name: text`, and that text becomes
 * the workout's note. A workout whose exercises carried nothing gets `''`. The
 * `note` then comes off every exercise, so no reader finds the same words in
 * two places.
 *
 * A `workouts` that is not a list, a row that is not an object, and a workout
 * whose exercises are not a list are all left exactly as they came: this rung
 * has no more right to repair a malformed document than the shape check that
 * will refuse it a moment later.
 */

type Document = Record<string, unknown>;

/** The shape this rung produces. */
const VERSION_6 = 6;

function isObject(value: unknown): value is Document {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An exercise's note as one line of the workout's note, or `null` when it said nothing. */
function noteLine(exercise: unknown): string | null {
	if (!isObject(exercise)) return null;
	const note = exercise['note'];
	if (typeof note !== 'string' || note === '') return null;
	return `${String(exercise['name'])}: ${note}`;
}

function withoutNote(exercise: unknown): unknown {
	if (!isObject(exercise)) return exercise;
	const rest = { ...exercise };
	delete rest['note'];
	return rest;
}

function workoutWithNote(workout: unknown): unknown {
	if (!isObject(workout)) return workout;
	const exercises = workout['exercises'];
	if (!Array.isArray(exercises)) return workout;
	const lines = exercises.map(noteLine).filter((line) => line !== null);
	return { ...workout, note: lines.join('\n'), exercises: exercises.map(withoutNote) };
}

/**
 * The rung itself. `activeWorkout` is a field of its own rather than a member of
 * `workouts`, so it is named separately: missing it would strand the notes of the
 * session somebody is standing in while the ones behind it moved.
 */
export function migrate_5_to_6(document: Document): Document {
	const workouts = document['workouts'];
	return {
		...document,
		schemaVersion: VERSION_6,
		workouts: Array.isArray(workouts) ? workouts.map(workoutWithNote) : workouts,
		activeWorkout: workoutWithNote(document['activeWorkout'])
	};
}

import type { LibraryExercise, RoutineExercise } from '$lib/domain/types';

/** The movements the app knows about. Data only; the reshaping lives in `exercises.ts`. */
export const EXERCISE_LIBRARY: readonly LibraryExercise[] = [
	{ name: 'Bench Press', group: 'Chest' },
	{ name: 'Incline Bench Press', group: 'Chest' },
	{ name: 'Decline Bench Press', group: 'Chest' },
	{ name: 'Dumbbell Fly', group: 'Chest' },
	{ name: 'Pec Deck', group: 'Chest' },
	{ name: 'Cable Cross-over', group: 'Chest' },
	{ name: 'Push-up', group: 'Chest' },
	{ name: 'Lat Pulldown', group: 'Back' },
	{ name: 'Seated Row', group: 'Back' },
	{ name: 'Pull-up', group: 'Back' },
	{ name: 'Reverse Fly', group: 'Back' },
	{ name: 'Pullover', group: 'Back' },
	{ name: 'Machine Press', group: 'Shoulders' },
	{ name: 'Lateral Raise', group: 'Shoulders' },
	{ name: 'Upright Row', group: 'Shoulders' },
	{ name: 'Shrug', group: 'Shoulders' },
	{ name: 'Triceps Pushdown', group: 'Triceps' },
	{ name: 'Rope Pushdown', group: 'Triceps' },
	{ name: 'Kickback', group: 'Triceps' },
	{ name: 'Barbell Curl', group: 'Biceps' },
	{ name: 'Hammer Curl', group: 'Biceps' },
	{ name: 'Preacher Curl', group: 'Biceps' },
	{ name: 'Squat', group: 'Legs' },
	{ name: 'Leg Press', group: 'Legs' },
	{ name: 'Leg Extension', group: 'Legs' },
	{ name: 'Leg Curl', group: 'Legs' },
	{ name: 'Calf Raise', group: 'Legs' },
	{ name: 'Deadlift', group: 'Legs' }
];

/**
 * Form cues per movement. A movement with none falls back to
 * `DEFAULT_FORM_CUES` rather than showing an empty panel.
 */
export const FORM_CUES: Readonly<Record<string, readonly string[]>> = {
	'Bench Press': [
		'Shoulder blades pinned back and down, chest open.',
		'Bar travels to mid-chest, elbows at about 75°.',
		'Feet planted, ribs down — no bounce off the chest.'
	],
	'Incline Bench Press': [
		'Bench at 30–45°; any higher becomes a shoulder press.',
		'Wrists stacked over elbows through the whole path.',
		'Lower to the upper chest, not the collarbone.'
	],
	'Lat Pulldown': [
		'Sit tall, slight lean back, chest lifted.',
		'Lead with the elbows, not the hands.',
		'Stop at the collarbone; control the way up.'
	],
	Squat: [
		'Bar over mid-foot, whole foot loaded.',
		'Knees track over the toes as you descend.',
		'Neutral spine — no rounding at the bottom.'
	],
	'Lateral Raise': [
		'Lift to shoulder height, thumbs level with the little finger.',
		'Small forward lean, elbows softly bent.',
		'Shoulders stay down; the traps do not shrug.'
	],
	'Triceps Pushdown': [
		'Upper arms locked to the ribs.',
		'Extend fully, then release slowly.',
		'Wrists neutral, no swinging from the hips.'
	],
	'Push-up': [
		'Hands under shoulders, body one straight line head to heel.',
		'Elbows track back at about 45°, not flared to the sides.',
		'Chest to just above the floor, then press up without sagging the hips.'
	]
};

export const DEFAULT_FORM_CUES: readonly string[] = [
	'Set up braced: ribs down, spine neutral.',
	'Move through the full range under control.',
	'Two seconds down, one second up.'
];

/**
 * Real demonstration clips, keyed by movement name. A movement with no entry
 * here has no clip — `FormCheckModal` shows the honest gap instead of a fake
 * player. `description` is the screen-reader account of what the clip shows.
 */
export const DEMOS: Readonly<Record<string, { src: string; description: string }>> = {
	'Push-up': {
		src: '/media/push-up-demo.mp4',
		description:
			'Demonstration: a push-up performed with hands under the shoulders, body in a straight line from head to heel, lowering the chest toward the floor, then pressing back up.'
	},
	Squat: {
		src: '/media/squat-demo.mp4',
		description:
			'Demonstration: a squat performed with the feet planted, descending under control with the knees tracking over the toes and the spine neutral, then driving back up to standing.'
	}
};

/** A routine row as it appears within a template. */
type TemplateRoutine = {
	id: string;
	name: string;
	exercises: RoutineExercise[];
};

export type RoutineTemplate = {
	id: string;
	/**
	 * The badge on the shelf: how many sessions a week the programme is written
	 * for. It describes the template, not a schedule — which days those sessions
	 * land on is planned per day, afterwards.
	 */
	badge: string;
	name: string;
	sub: string;
	body: string;
	routines: TemplateRoutine[];
};

/**
 * First-run starting points. The loads are a beginner's opening offer, not a
 * prescription — every value is editable afterwards. They are in kilograms,
 * like every stored load, and read back in whichever unit the account is set to.
 */
export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
	{
		id: 'ppl',
		badge: '3×',
		name: 'Chest & Shoulders / Back & Arms / Legs',
		sub: 'Three days a week',
		body: 'The classic rotation. Each day covers a couple of muscle groups, so nothing waits a fortnight for its turn.',
		routines: [
			{
				id: 'push',
				name: 'Chest & Shoulders',
				exercises: [
					{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 45 },
					{ name: 'Incline Bench Press', group: 'Chest', sets: 3, reps: 10, load: 30 },
					{ name: 'Dumbbell Fly', group: 'Chest', sets: 3, reps: 12, load: 14 },
					{ name: 'Machine Press', group: 'Shoulders', sets: 3, reps: 10, load: 25 },
					{ name: 'Lateral Raise', group: 'Shoulders', sets: 3, reps: 15, load: 8 },
					{ name: 'Triceps Pushdown', group: 'Triceps', sets: 3, reps: 12, load: 27 }
				]
			},
			{
				id: 'pull',
				name: 'Back & Arms',
				exercises: [
					{ name: 'Lat Pulldown', group: 'Back', sets: 4, reps: 10, load: 50 },
					{ name: 'Seated Row', group: 'Back', sets: 3, reps: 10, load: 45 },
					{ name: 'Pull-up', group: 'Back', sets: 3, reps: 8, load: 0 },
					{ name: 'Reverse Fly', group: 'Back', sets: 3, reps: 15, load: 10 },
					{ name: 'Barbell Curl', group: 'Biceps', sets: 3, reps: 12, load: 20 },
					{ name: 'Hammer Curl', group: 'Biceps', sets: 3, reps: 12, load: 14 }
				]
			},
			{
				id: 'legs',
				name: 'Legs',
				exercises: [
					{ name: 'Squat', group: 'Legs', sets: 5, reps: 5, load: 70 },
					{ name: 'Leg Press', group: 'Legs', sets: 4, reps: 10, load: 120 },
					{ name: 'Leg Extension', group: 'Legs', sets: 3, reps: 12, load: 35 },
					{ name: 'Leg Curl', group: 'Legs', sets: 3, reps: 12, load: 30 },
					{ name: 'Calf Raise', group: 'Legs', sets: 4, reps: 20, load: 60 }
				]
			}
		]
	},
	{
		id: 'ul',
		badge: '4×',
		name: 'Upper / Lower',
		sub: 'Four days a week',
		body: 'Two upper-body days and two lower-body days. More frequency per muscle group, more days in the gym.',
		routines: [
			{
				id: 'upper',
				name: 'Upper',
				exercises: [
					{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 45 },
					{ name: 'Lat Pulldown', group: 'Back', sets: 4, reps: 10, load: 50 },
					{ name: 'Machine Press', group: 'Shoulders', sets: 3, reps: 10, load: 25 },
					{ name: 'Seated Row', group: 'Back', sets: 3, reps: 10, load: 45 },
					{ name: 'Lateral Raise', group: 'Shoulders', sets: 3, reps: 15, load: 8 },
					{ name: 'Barbell Curl', group: 'Biceps', sets: 3, reps: 12, load: 20 },
					{ name: 'Triceps Pushdown', group: 'Triceps', sets: 3, reps: 12, load: 27 }
				]
			},
			{
				id: 'lower',
				name: 'Lower',
				exercises: [
					{ name: 'Squat', group: 'Legs', sets: 4, reps: 6, load: 70 },
					{ name: 'Leg Press', group: 'Legs', sets: 4, reps: 10, load: 120 },
					{ name: 'Leg Curl', group: 'Legs', sets: 3, reps: 12, load: 30 },
					{ name: 'Leg Extension', group: 'Legs', sets: 3, reps: 12, load: 35 },
					{ name: 'Calf Raise', group: 'Legs', sets: 4, reps: 20, load: 60 }
				]
			}
		]
	},
	{
		id: 'fb',
		badge: '2×',
		name: 'Full body',
		sub: 'Two days a week',
		body: 'Six compound movements, twice a week. The least time in the gym for a first month back.',
		routines: [
			{
				id: 'full-body',
				name: 'Full body',
				exercises: [
					{ name: 'Squat', group: 'Legs', sets: 3, reps: 8, load: 60 },
					{ name: 'Bench Press', group: 'Chest', sets: 3, reps: 8, load: 45 },
					{ name: 'Seated Row', group: 'Back', sets: 3, reps: 10, load: 45 },
					{ name: 'Machine Press', group: 'Shoulders', sets: 3, reps: 10, load: 25 },
					{ name: 'Barbell Curl', group: 'Biceps', sets: 2, reps: 12, load: 20 },
					{ name: 'Calf Raise', group: 'Legs', sets: 3, reps: 15, load: 60 }
				]
			}
		]
	}
];

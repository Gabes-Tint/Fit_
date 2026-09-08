import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMOS, EXERCISE_LIBRARY, FORM_CUES, ROUTINE_TEMPLATES } from './exercise-catalog';
import {
	alternativesTo,
	bumpField,
	emptyRoutine,
	exercisesFromLibrary,
	formatLoad,
	formCues,
	libraryExercise,
	libraryFor,
	muscleSections,
	routinesFromTemplate,
	routineTotals,
	searchLibrary
} from './exercises';
import type { Routine, RoutineExercise } from './types';

const STATIC_ROOT = fileURLToPath(new URL('../../../static', import.meta.url));

function row(name: string, group: RoutineExercise['group'], sets = 3): RoutineExercise {
	return { name, group, sets, reps: 10, load: 20 };
}

function routine(exercises: RoutineExercise[]): Routine {
	return { id: 'r1', name: 'Push', exercises, deletedAt: null };
}

describe('the exercise library', () => {
	it('finds a movement by name', () => {
		expect(libraryExercise('Bench Press')).toEqual({ name: 'Bench Press', group: 'Chest' });
	});

	it('does not invent a movement it has never heard of', () => {
		expect(libraryExercise('Tyre Flip')).toBeUndefined();
	});

	it('offers the whole library when no group is chosen', () => {
		expect(libraryFor(null)).toHaveLength(EXERCISE_LIBRARY.length);
	});

	it('narrows to one muscle group', () => {
		const chest = libraryFor('Chest');
		expect(chest.length).toBeGreaterThan(0);
		expect(chest.length).toBeLessThan(EXERCISE_LIBRARY.length);
		for (const e of chest) expect(e.group).toBe('Chest');
	});
});

describe('searching the library', () => {
	it('matches a substring anywhere in the name', () => {
		expect(searchLibrary('press', null).map((e) => e.name)).toContain('Bench Press');
		expect(searchLibrary('press', null).map((e) => e.name)).toContain('Leg Press');
	});

	it('ignores case', () => {
		expect(searchLibrary('SQUAT', null).map((e) => e.name)).toEqual(['Squat']);
	});

	it('trims stray whitespace before matching', () => {
		expect(searchLibrary('  squat  ', null).map((e) => e.name)).toEqual(['Squat']);
	});

	it('says nothing matches by returning nothing', () => {
		expect(searchLibrary('tyre flip', null)).toEqual([]);
	});

	it('combines a query with a muscle group filter', () => {
		expect(searchLibrary('press', 'Chest').map((e) => e.name)).toEqual([
			'Bench Press',
			'Incline Bench Press',
			'Decline Bench Press'
		]);
		expect(searchLibrary('press', 'Legs').map((e) => e.name)).toEqual(['Leg Press']);
	});

	it('returns the unfiltered group when the query is empty', () => {
		expect(searchLibrary('', 'Chest')).toEqual(libraryFor('Chest'));
		expect(searchLibrary('   ', null)).toEqual(libraryFor(null));
	});
});

describe('alternatives', () => {
	it('offers other movements for the same muscle group', () => {
		const alternatives = alternativesTo('Bench Press');
		expect(alternatives.length).toBeGreaterThan(0);
		for (const e of alternatives) expect(e.group).toBe('Chest');
	});

	it('does not offer a movement as its own replacement', () => {
		expect(alternativesTo('Bench Press').map((e) => e.name)).not.toContain('Bench Press');
	});

	it('has nothing to offer for a movement it does not know', () => {
		expect(alternativesTo('Tyre Flip')).toEqual([]);
	});
});

describe('form cues', () => {
	it('gives the written cues for a movement that has them', () => {
		expect(formCues('Bench Press')).toBe(FORM_CUES['Bench Press']);
	});

	it('falls back to the general cues rather than an empty panel', () => {
		expect(formCues('Shrug')).toEqual([
			'Set up braced: ribs down, spine neutral.',
			'Move through the full range under control.',
			'Two seconds down, one second up.'
		]);
	});
});

describe('demo clips', () => {
	it('names the movements that have one, and no others', () => {
		expect(Object.keys(DEMOS).sort()).toEqual(['Push-up', 'Squat']);
	});

	it('has nothing for a movement with no clip yet', () => {
		expect(DEMOS['Bench Press']).toBeUndefined();
	});

	// The modal renders `src` straight into a <video>, so an entry naming a file
	// that is not shipped is a broken player rather than the honest gap.
	it('points every entry at a clip that is actually shipped', () => {
		const broken = Object.entries(DEMOS)
			.filter(
				([, demo]) =>
					!/^\/media\/[\w-]+\.mp4$/.test(demo.src) || !existsSync(join(STATIC_ROOT, demo.src))
			)
			.map(([name, demo]) => `${name}: ${demo.src}`);
		expect(broken).toEqual([]);
	});

	// The clip carries the whole instruction, so a demo without a description
	// leaves a screen-reader user with a button and nothing else.
	it('describes every clip for someone who cannot see it', () => {
		const silent = Object.entries(DEMOS)
			.filter(([, demo]) => demo.description.length < 40)
			.map(([name]) => name);
		expect(silent).toEqual([]);
	});
});

describe('routine arithmetic', () => {
	it('counts no sets in an empty routine', () => {
		expect(routineTotals(routine([])).sets).toBe(0);
	});

	it('reports movements, sets and an estimated length together', () => {
		const totals = routineTotals(routine([row('Squat', 'Legs', 5), row('Leg Press', 'Legs', 5)]));
		expect(totals.exercises).toBe(2);
		expect(totals.sets).toBe(10);
		expect(totals.minutes).toBe(32);
	});

	it('rounds the estimate to whole minutes', () => {
		expect(routineTotals(routine([row('Squat', 'Legs', 3)])).minutes).toBe(10);
	});
});

describe('muscle sections', () => {
	it('keeps the order the groups first appear in', () => {
		const sections = muscleSections([
			row('Squat', 'Legs'),
			row('Bench Press', 'Chest'),
			row('Lateral Raise', 'Shoulders')
		]);
		expect(sections.map((s) => s.group)).toEqual(['Legs', 'Chest', 'Shoulders']);
	});

	it('merges a group that appears twice into its first position', () => {
		const sections = muscleSections([
			row('Bench Press', 'Chest'),
			row('Squat', 'Legs'),
			row('Dumbbell Fly', 'Chest')
		]);
		expect(sections.map((s) => s.group)).toEqual(['Chest', 'Legs']);
		expect(sections[0]?.exercises.map((e) => e.name)).toEqual(['Bench Press', 'Dumbbell Fly']);
		expect(sections[1]?.exercises).toHaveLength(1);
	});

	it('has no sections for a routine with no movements', () => {
		expect(muscleSections([])).toEqual([]);
	});
});

describe('adding from the library', () => {
	it('prescribes three sets of ten at bodyweight until it is edited', () => {
		expect(exercisesFromLibrary(['Squat'])).toEqual([
			{ name: 'Squat', group: 'Legs', sets: 3, reps: 10, load: 0 }
		]);
	});

	it('drops a name the library does not know rather than guessing at it', () => {
		expect(exercisesFromLibrary(['Squat', 'Tyre Flip', 'Deadlift']).map((e) => e.name)).toEqual([
			'Squat',
			'Deadlift'
		]);
	});

	it('adds nothing when nothing was picked', () => {
		expect(exercisesFromLibrary([])).toEqual([]);
	});
});

describe('starting from a template', () => {
	it('carries every routine over with its name and movements', () => {
		const template = ROUTINE_TEMPLATES[0];
		if (!template) throw new Error('the template list is empty');
		const routines = routinesFromTemplate(template);
		expect(routines.map((r) => r.id)).toEqual(template.routines.map((r) => r.id));
		expect(routines[0]?.name).toBe(template.routines[0]?.name);
		expect(routines[0]?.exercises).toEqual(template.routines[0]?.exercises);
	});

	it('copies deeply enough that editing the copy leaves the template alone', () => {
		const template = ROUTINE_TEMPLATES[0];
		if (!template) throw new Error('the template list is empty');
		const originalLoad = template.routines[0]?.exercises[0]?.load;
		const originalCount = template.routines[0]?.exercises.length ?? 0;
		const routines = routinesFromTemplate(template);
		const first = routines[0];
		if (!first?.exercises[0]) throw new Error('the first template routine is empty');
		first.name = 'Renamed';
		first.exercises[0].load = 999;
		first.exercises.push(row('Pull-up', 'Back'));
		expect(template.routines[0]?.name).not.toBe('Renamed');
		expect(template.routines[0]?.exercises[0]?.load).toBe(originalLoad);
		expect(template.routines[0]?.exercises).toHaveLength(originalCount);
	});
});

describe('an empty routine', () => {
	it('opens named, three times a week, with nothing in it', () => {
		expect(emptyRoutine('r-7')).toEqual({
			id: 'r-7',
			name: 'New routine',
			exercises: [],
			deletedAt: null
		});
	});
});

describe('stepping a field', () => {
	it('moves sets and reps by one and load by a plate', () => {
		expect(bumpField('sets', 3, 1)).toBe(4);
		expect(bumpField('reps', 10, 1)).toBe(11);
		expect(bumpField('load', 40, 1)).toBe(42.5);
	});

	it('steps back down by the same amount', () => {
		expect(bumpField('sets', 3, -1)).toBe(2);
		expect(bumpField('reps', 10, -1)).toBe(9);
		expect(bumpField('load', 40, -1)).toBe(37.5);
	});

	it('stops sets and reps at one, because a set of none is a removal', () => {
		expect(bumpField('sets', 1, -1)).toBe(1);
		expect(bumpField('reps', 1, -1)).toBe(1);
	});

	it('stops load at bodyweight rather than going negative', () => {
		expect(bumpField('load', 2.5, -1)).toBe(0);
		expect(bumpField('load', 0, -1)).toBe(0);
	});

	it('will not go past eight sets of one movement', () => {
		expect(bumpField('sets', 7, 1)).toBe(8);
		expect(bumpField('sets', 8, 1)).toBe(8);
	});

	it('leaves reps and load unbounded above', () => {
		expect(bumpField('reps', 30, 1)).toBe(31);
		expect(bumpField('load', 200, 1)).toBe(202.5);
	});

	it('stays on the 2.5 step without collecting floating-point dust', () => {
		let load = 0;
		for (let i = 0; i < 9; i++) load = bumpField('load', load, 1);
		expect(load).toBe(22.5);
		for (let i = 0; i < 9; i++) load = bumpField('load', load, -1);
		expect(load).toBe(0);
	});

	it('does not move for a direction of neither up nor down', () => {
		expect(bumpField('load', 40, 0)).toBe(40);
		expect(bumpField('sets', 3, 0)).toBe(3);
	});
});

describe('showing a load', () => {
	it('reads bodyweight as an em dash rather than as nothing lifted', () => {
		expect(formatLoad(0)).toBe('—');
	});

	it('shows a load as its own number', () => {
		expect(formatLoad(42.5)).toBe('42.5');
		expect(formatLoad(60)).toBe('60');
	});
});

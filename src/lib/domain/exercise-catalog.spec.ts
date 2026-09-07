import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FORM_CUES,
	EXERCISE_LIBRARY,
	FORM_CUES,
	ROUTINE_TEMPLATES
} from './exercise-catalog';
import { MUSCLE_GROUPS } from './types';

const LIBRARY_NAMES = new Set(EXERCISE_LIBRARY.map((e) => e.name));
const GROUP_OF = new Map(EXERCISE_LIBRARY.map((e) => [e.name, e.group]));

describe('the exercise library', () => {
	it('names each movement once', () => {
		expect(LIBRARY_NAMES.size).toBe(EXERCISE_LIBRARY.length);
	});

	it('files every movement under a muscle group the app knows', () => {
		for (const exercise of EXERCISE_LIBRARY) {
			expect(MUSCLE_GROUPS).toContain(exercise.group);
		}
	});

	it('has at least one movement for every muscle group it offers', () => {
		for (const group of MUSCLE_GROUPS) {
			expect(EXERCISE_LIBRARY.some((e) => e.group === group)).toBe(true);
		}
	});
});

describe('form cues', () => {
	it('writes cues only for movements that exist', () => {
		for (const name of Object.keys(FORM_CUES)) {
			expect(LIBRARY_NAMES.has(name)).toBe(true);
		}
	});

	it('gives three things to watch, every time', () => {
		expect(DEFAULT_FORM_CUES).toHaveLength(3);
		for (const cues of Object.values(FORM_CUES)) {
			expect(cues).toHaveLength(3);
			for (const cue of cues) expect(cue.length).toBeGreaterThan(0);
		}
	});
});

describe('the starter templates', () => {
	it('offers more than one way to begin', () => {
		expect(ROUTINE_TEMPLATES.length).toBeGreaterThan(1);
	});

	it('gives every template a unique id and something to read', () => {
		expect(new Set(ROUTINE_TEMPLATES.map((t) => t.id)).size).toBe(ROUTINE_TEMPLATES.length);
		for (const template of ROUTINE_TEMPLATES) {
			expect(template.name.length).toBeGreaterThan(0);
			expect(template.sub.length).toBeGreaterThan(0);
			expect(template.body.length).toBeGreaterThan(0);
			expect(template.badge).toMatch(/^\d×$/);
		}
	});

	it('gives every routine in a template a unique id and some movements', () => {
		for (const template of ROUTINE_TEMPLATES) {
			const ids = template.routines.map((r) => r.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(template.routines.length).toBeGreaterThan(0);
			for (const routine of template.routines) {
				expect(routine.exercises.length).toBeGreaterThan(0);
			}
		}
	});

	it('only prescribes movements the library holds, under the library’s own group', () => {
		for (const template of ROUTINE_TEMPLATES) {
			for (const routine of template.routines) {
				for (const exercise of routine.exercises) {
					expect(LIBRARY_NAMES.has(exercise.name)).toBe(true);
					expect(exercise.group).toBe(GROUP_OF.get(exercise.name));
				}
			}
		}
	});

	it('prescribes sets and reps that can actually be done', () => {
		for (const template of ROUTINE_TEMPLATES) {
			for (const routine of template.routines) {
				for (const exercise of routine.exercises) {
					expect(exercise.sets).toBeGreaterThan(0);
					expect(exercise.sets).toBeLessThanOrEqual(8);
					expect(exercise.reps).toBeGreaterThan(0);
					expect(exercise.load).toBeGreaterThanOrEqual(0);
				}
			}
		}
	});
});

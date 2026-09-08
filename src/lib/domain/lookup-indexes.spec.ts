import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The recipe book and the exercise library are each indexed once, by a
 * module-level `const` that runs when the module first loads. Two things follow,
 * and together they are why these tests sit apart from `catalog.spec.ts` and
 * `exercises.spec.ts` rather than beside the rest of their subject.
 *
 * A test holding a binding some earlier import already produced never observes
 * the index being built, so the build has to happen inside the test: the
 * registry is reset and the module re-imported here, which is what
 * `types.spec.ts` does for the same reason.
 *
 * And a file that also imports the module at the top cannot report on the build
 * failing. An index that throws while it is being built throws during
 * collection, and a collection that throws yields no test results at all --
 * reported as no test having failed rather than as the failure it is, the same
 * trap `export-data.spec.ts` documents. So nothing here is imported statically.
 */
beforeEach(() => {
	vi.resetModules();
});

describe('the recipe index', () => {
	it('holds every recipe in the book, under its own id', async () => {
		const { RECIPES, RECIPE_BY_ID } = await import('./recipes');
		expect(Object.keys(RECIPE_BY_ID)).toEqual(RECIPES.map((r) => r.id));
		expect(RECIPE_BY_ID['yogurt-bowl']?.name).toBe('Greek yogurt, berries, chia');
	});
});

describe('the exercise index', () => {
	it('holds every movement in the library, under its own name', async () => {
		const { EXERCISE_LIBRARY } = await import('./exercise-catalog');
		const { libraryExercise } = await import('./exercises');
		expect(libraryExercise('Bench Press')).toEqual({ name: 'Bench Press', group: 'Chest' });
		const missing = EXERCISE_LIBRARY.filter((m) => libraryExercise(m.name) !== m).map(
			(m) => m.name
		);
		expect(missing).toEqual([]);
	});
});

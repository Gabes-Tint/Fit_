import { describe, expect, it } from 'vitest';

/**
 * `SEED_FOOD_BY_ID` is built once, at module load, out of `SEED_FOODS`.
 *
 * Every other spec imports `./foods` at the top of the file, which means a fault
 * in that index is not a failing assertion but a module that throws before
 * anything is collected -- vitest reports "no tests" and mutation testing
 * records a survivor, because no test ever ran to disagree. The imports below
 * are deliberately dynamic: a broken index arrives here as a rejected promise
 * inside a test that exists, and says which food it lost.
 *
 * There is nothing to import statically at the top of this file for the same
 * reason -- pulling in `./types` would be harmless, but anything reaching
 * `./foods` would take the collection down with it.
 */
describe('the seeded food index', () => {
	it('reaches every seeded food by its own id', async () => {
		const { SEED_FOOD_BY_ID, SEED_FOODS } = await import('./foods');
		// Collected rather than asserted one at a time, so a failure names every
		// food the index lost instead of stopping at the first.
		const lost = SEED_FOODS.filter((food) => SEED_FOOD_BY_ID[food.id] !== food).map((f) => f.id);
		expect(lost).toEqual([]);
	});

	it('holds exactly the seeded foods and nothing else', async () => {
		const { SEED_FOOD_BY_ID, SEED_FOODS } = await import('./foods');
		expect(Object.keys(SEED_FOOD_BY_ID).sort()).toEqual(SEED_FOODS.map((f) => f.id).sort());
	});

	it('names a food the sample journal logs, with the nutrition it logs it at', async () => {
		// The index is what `logFromFood` looks an id up in, so a lost or shuffled
		// entry is the sample journal silently logging the wrong food.
		const { SEED_FOOD_BY_ID } = await import('./foods');
		expect(SEED_FOOD_BY_ID['egg-large']).toMatchObject({ name: 'Egg, large', kcal: 72 });
	});
});

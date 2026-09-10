import { describe, expect, it } from 'vitest';
import { assessPlausibility, KCAL_CEILING, type MacroRow } from './plausibility';

/** A fully-stated row with everything but the given overrides at zero/null. */
function row(overrides: Partial<MacroRow>): MacroRow {
	return {
		kcal: null,
		protein: null,
		carbs: null,
		fat: null,
		fiber: null,
		alcohol: null,
		...overrides
	};
}

describe('assessPlausibility', () => {
	it('passes pure oil at the Atwater ceiling: 900 kcal, 100 g fat', () => {
		const verdict = assessPlausibility(row({ kcal: 900, protein: 0, carbs: 0, fat: 100 }));
		expect(verdict.status).toBe('pass');
	});

	it('passes hard candy: 400 kcal, 100 g carbs', () => {
		const verdict = assessPlausibility(row({ kcal: 400, protein: 0, carbs: 100, fat: 0 }));
		expect(verdict.status).toBe('pass');
	});

	it('fails an "apple" stated at 400 kcal with only 14 g carbs', () => {
		const verdict = assessPlausibility(row({ kcal: 400, protein: 0, carbs: 14, fat: 0 }));
		expect(verdict.status).toBe('fail');
	});

	it('fails a row with kcal 0 and macros present', () => {
		const verdict = assessPlausibility(row({ kcal: 0, protein: 5, carbs: 10, fat: 2 }));
		expect(verdict.status).toBe('fail');
	});

	it('skips a row with no macros at all, regardless of kcal', () => {
		const verdict = assessPlausibility(row({ kcal: 250 }));
		expect(verdict.status).toBe('skipped');
	});

	it('skips a row with no stated kcal, even with macros present', () => {
		const verdict = assessPlausibility(row({ kcal: null, protein: 10, carbs: 5, fat: 1 }));
		expect(verdict.status).toBe('skipped');
	});

	it('fails a row above the 900 kcal ceiling even when its own macros would justify it', () => {
		// 100 g fat plus 10 g protein implies an Atwater estimate above 900, but
		// nothing at 100 g may pass above the physical ceiling.
		const verdict = assessPlausibility(row({ kcal: 940, protein: 10, carbs: 0, fat: 100 }));
		expect(verdict.status).toBe('fail');
		expect(KCAL_CEILING).toBe(900);
	});

	it('counts fibre toward the Atwater estimate when present', () => {
		// 10 g carbs alone implies 40 kcal ± 15% (34–46); 250 kcal fails without
		// fibre. With 100 g fibre added at 2 kcal/g the estimate is 240, and 250
		// falls inside its ±15% band (204–276).
		const verdict = assessPlausibility(
			row({ kcal: 250, protein: 0, carbs: 10, fat: 0, fiber: 100 })
		);
		expect(verdict.status).toBe('pass');
	});
});

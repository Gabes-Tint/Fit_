/**
 * A physical plausibility check for one food row's energy value.
 *
 * The Atwater system explains kcal per 100 g as a linear function of the
 * macros: protein and carbohydrate each carry 4 kcal/g, fat 9, alcohol 7,
 * and fibre a nominal 2 (it is only partly digested). A row is physically
 * plausible when its stated kcal sits within ±15% of what its own stated
 * macros imply, and never above 900 regardless — 900 is the ceiling of pure
 * fat (9 kcal/g × 100 g), so nothing solid or liquid at 100 g should clear it
 * even inside the tolerance band.
 *
 * This is a predicate, not a cleanup: it says which rows are implausible, and
 * leaves the decision of what to do with them to the audit script's caller.
 */

/** Kcal per gram, by macro. Alcohol and fibre are optional inputs below. */
const ATWATER = {
	protein: 4,
	carbs: 4,
	fat: 9,
	alcohol: 7,
	fiber: 2
} as const;

/** How far the stated kcal may drift from the Atwater estimate and still pass. */
const TOLERANCE = 0.15;

/** No food is plausible above this per 100 g, regardless of its macros. */
export const KCAL_CEILING = 900;

/** One row's macros per 100 g, `null` where the catalog does not state one. */
export type MacroRow = {
	kcal: number | null;
	protein: number | null;
	carbs: number | null;
	fat: number | null;
	fiber: number | null;
	alcohol: number | null;
};

export type PlausibilityVerdict =
	| { status: 'skipped' }
	| { status: 'pass'; atwaterLower: number; atwaterUpper: number }
	| { status: 'fail'; atwaterLower: number; atwaterUpper: number };

/**
 * `true` once at least one energy-bearing macro is stated, so a row with
 * fibre alone (no protein, carbs or fat) is still assessed rather than
 * treated as having no macros at all.
 */
function hasAnyMacro(row: MacroRow): boolean {
	return row.protein !== null || row.carbs !== null || row.fat !== null || row.alcohol !== null;
}

/**
 * Assess one row. `skipped` when there is nothing to check it against — no
 * kcal, or no macro at all — because a missing value is a data gap, not a
 * physical impossibility, and should be counted separately rather than
 * folded into the failures.
 */
export function assessPlausibility(row: MacroRow): PlausibilityVerdict {
	if (row.kcal === null || !hasAnyMacro(row)) return { status: 'skipped' };
	const atwaterKcal =
		(row.protein ?? 0) * ATWATER.protein +
		(row.carbs ?? 0) * ATWATER.carbs +
		(row.fat ?? 0) * ATWATER.fat +
		(row.alcohol ?? 0) * ATWATER.alcohol +
		(row.fiber ?? 0) * ATWATER.fiber;
	const atwaterLower = atwaterKcal * (1 - TOLERANCE);
	const atwaterUpper = atwaterKcal * (1 + TOLERANCE);
	const withinAtwaterRange = row.kcal >= atwaterLower && row.kcal <= atwaterUpper;
	const withinCeiling = row.kcal <= KCAL_CEILING;
	return withinAtwaterRange && withinCeiling
		? { status: 'pass', atwaterLower, atwaterUpper }
		: { status: 'fail', atwaterLower, atwaterUpper };
}

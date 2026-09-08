/**
 * The quantity the log sheet is edited in: a count of the food's own serving,
 * with grams a toggle away (#158).
 *
 * Servings are the canonical number and the only one anything stores. A
 * `LogItem` and a proposal have both carried `servings` since the app was
 * written, so expressing the sheet's quantity this way adds no field to the
 * state document and needs no migration rung — the grams a person sees are
 * derived from the serving weight `serving-display.ts` already knows how to
 * find (#74), and are derived again from scratch every time they are shown.
 *
 * That is also what makes the toggle lossless. Switching to grams and back
 * converts nothing: the amount underneath never moved, so a half serving is
 * still a half serving rather than 109.5 g read back as 0.5000000001. Only
 * typing into the grams field ever writes, and then the servings it computes
 * are what gets stored.
 *
 * Fractions survive a round trip because the grid is eighths and eighths are
 * exact in both IEEE-754 and JSON: 0.125, 0.375 and 0.625 are written and
 * read back unchanged, where a third never could be. `roundAmount` is what
 * holds the grid — thousandths, which is exactly the precision an eighth
 * needs and no more.
 */

import { servingMassGrams, type PortionSource } from './serving-display';
import type { Food, UnitSystem } from './types';
import { gToOz, ozToG } from './units';
import { round1 } from './utils';

/**
 * The smallest amount the sheet will log, and the floor the stepper stops at.
 *
 * An eighth rather than the quarter `QuantityStepper` floors at: the whole
 * point of this control is that eighths are reachable, and a stepper that
 * refuses to hold the number a person just typed is a stepper that throws
 * their input away.
 */
export const EIGHTH = 0.125;

/**
 * An amount on the grid the sheet works in: thousandths.
 *
 * Fine enough that every eighth (0.125, 0.375, 0.625, 0.875) is exact, coarse
 * enough that floating-point noise never reaches the screen — 0.1 + 0.2 reads
 * as 0.3, not as 0.30000000000000004. Deliberately finer than
 * `describePortion`'s two decimals (#74), which is a display rule for a
 * portion already chosen; this is the number being chosen.
 */
export function roundAmount(amount: number): number {
	return Math.round(amount * 1000) / 1000;
}

/**
 * The amount a stepper tap lands on: the current amount plus a signed delta,
 * never below `EIGHTH`.
 *
 * The delta is signed by the caller rather than passed as a step and a
 * direction, because a direction is always 1 or -1 and multiplying by either
 * of those is the same as dividing by it — an arithmetic that no test could
 * ever tell apart.
 */
export function stepAmount(current: number, delta: number): number {
	return Math.max(EIGHTH, roundAmount(current + delta));
}

/**
 * A count somebody typed: "1.5", "0.125", "1/8", "1 1/2".
 *
 * Fractions are read because eighths are the reason this control exists and
 * "1/8" is how a person writes one. `null` for anything that is not a
 * positive amount — empty text, a word, a zero, a division by zero — so the
 * caller leaves the amount alone rather than logging nothing at all.
 */
const FRACTION = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/;

/**
 * A matched fraction as a number. No guard against a zero denominator: "1/0"
 * is Infinity and "0/0" is NaN, and `parseAmount`'s own finiteness test
 * refuses both — a second check here would be one no input could reach.
 */
function fractionValue(match: RegExpExecArray): number {
	return Number(match[1] ?? 0) + Number(match[2]) / Number(match[3]);
}

export function parseAmount(text: string): number | null {
	const trimmed = text.trim();
	const fraction = FRACTION.exec(trimmed);
	// `Number('')` and `Number('  ')` are 0, `Number('two')` is NaN, and
	// `Number('1e999')` is Infinity. The test below refuses all three, so none
	// of them needs a guard of its own.
	const amount = roundAmount(fraction === null ? Number(trimmed) : fractionValue(fraction));
	return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * What `servings` of this food weighs, or `null` when nothing knows what one
 * serving weighs — the answer for a food the catalog priced by neither weight
 * nor a label stating one. `null` is what keeps the grams toggle off such a
 * food instead of inventing the 100 g that #157 spent a whole issue removing.
 */
export function amountGrams(source: PortionSource, servings: number): number | null {
	const perServing = servingMassGrams(source);
	return perServing === null ? null : perServing * servings;
}

/**
 * The servings a typed weight comes to, or `null` when the food has no
 * serving weight to divide by, or when the weight rounds away to nothing.
 */
export function amountFromGrams(source: PortionSource, grams: number): number | null {
	const perServing = servingMassGrams(source);
	if (perServing === null) return null;
	const servings = roundAmount(grams / perServing);
	return servings > 0 ? servings : null;
}

/** The per-serving numbers an energy line is read off. */
export type EnergySource = Pick<Food, 'kcal' | 'protein' | 'carbs' | 'fat'>;

/**
 * A weight as the amount field itself shows it: whole grams, or the one
 * decimal an ounce is read at, in the system the person set (#71, #74).
 *
 * The number without its unit, which is the one thing `formatServingMass`
 * cannot hand back — a field states its unit in its own label (#184) rather
 * than inside the value being edited. The conversion is `units.ts`'s, not a
 * second copy of it.
 */
export function massInUnits(grams: number, units: UnitSystem): number {
	return units === 'imperial' ? round1(gToOz(grams)) : Math.round(grams);
}

/** The grams a weight typed in the person's own system comes to. */
export function massToGrams(value: number, units: UnitSystem): number {
	return units === 'imperial' ? ozToG(value) : value;
}

/**
 * What the amount comes to, in energy and macros — the line that has to move
 * the moment the stepper does (#158).
 *
 * Read off the food's own per-serving numbers rather than through
 * `scaleFood`: that function exists to build a `LogItem`, so it scales all
 * thirteen micros as well, and nothing here shows a micro. Doing it this way
 * also keeps `foods.ts` and the seed food table out of the chunk the log
 * sheet is in, which is the chunk every page pays for.
 */
export function describeEnergy(food: EnergySource, servings: number): string {
	const macro = (value: number) => round1(value * servings);
	return `${Math.round(food.kcal * servings)} kcal · ${macro(food.protein)}g protein · ${macro(food.carbs)}g carbs · ${macro(food.fat)}g fat`;
}

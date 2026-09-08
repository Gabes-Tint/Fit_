import type { UnitSystem } from './types';
import { round1 } from './utils';

/**
 * Converts a canonical stored value (kilograms, centimeters) into the unit
 * system a person reads in, and back again for what they type. Storage is
 * never touched by this module — a `WeightEntry.kg` or `Profile.heightCm`
 * stays exactly as recorded no matter which system is on display. This is
 * the only place in the app a mass or a length is converted or rounded.
 */

const KG_PER_LB = 0.45359237; // exact, by international agreement
const CM_PER_IN = 2.54; // exact

export function kgToLb(kg: number): number {
	return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
	return lb * KG_PER_LB;
}

export function cmToIn(cm: number): number {
	return cm / CM_PER_IN;
}

export function inToCm(inches: number): number {
	return inches * CM_PER_IN;
}

/**
 * Grams in one ounce, derived from the pound rather than written out a second
 * time: an ounce is a sixteenth of the international pound by the same
 * agreement `KG_PER_LB` states, so the two constants can never drift apart.
 */
const G_PER_OZ = (KG_PER_LB * 1000) / 16;

export function gToOz(grams: number): number {
	return grams / G_PER_OZ;
}

export function ozToG(ounces: number): number {
	return ounces * G_PER_OZ;
}

/**
 * A serving mass read in the chosen system, with its unit: "244 g", "8.6 oz".
 *
 * Whole grams and one decimal ounce, because that is the precision a portion is
 * read at — a gram either way is inside the error of any household measure,
 * while a whole ounce would round a 14 g tablespoon of oil to nothing worth
 * printing. Unlike `formatWeight` this drops a trailing zero: a body weight is
 * read against yesterday's and needs its decimal place to line up, whereas a
 * portion is read on its own and "8.0 oz" only spends a character.
 */
export function formatServingMass(grams: number, units: UnitSystem): string {
	return units === 'imperial' ? `${round1(gToOz(grams))} oz` : `${Math.round(grams)} g`;
}

/** The word a screen reader should announce — never the abbreviation alone. */
export function weightUnitName(units: UnitSystem): string {
	return units === 'imperial' ? 'pounds' : 'kilograms';
}

export function weightUnitAbbr(units: UnitSystem): string {
	return units === 'imperial' ? 'lb' : 'kg';
}

/**
 * A stored `kg` (body weight, or a `kg`/week trend delta — the conversion is
 * a pure scale, so a delta converts the same way a quantity does), read in
 * the chosen system and rounded to the one decimal a body weight is read at.
 */
export function displayWeight(kg: number, units: UnitSystem): number {
	return round1(units === 'imperial' ? kgToLb(kg) : kg);
}

/** `displayWeight`, rendered so an exact reading never drops its decimal: "74.0 kg". */
export function formatWeight(kg: number, units: UnitSystem): string {
	return displayWeight(kg, units).toFixed(1);
}

/** The canonical `kg` for a number a person typed in the chosen system. */
export function weightToKg(value: number, units: UnitSystem): number {
	return units === 'imperial' ? lbToKg(value) : value;
}

/** A stored `heightCm`, read as whole feet and inches, which is how imperial states a height. */
export function heightToFeetInches(cm: number): { feet: number; inches: number } {
	const totalInches = Math.round(cmToIn(cm));
	return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

/** The canonical `heightCm` for feet and inches a person typed in imperial. */
export function heightFromFeetInches(feet: number, inches: number): number {
	return inToCm(feet * 12 + inches);
}

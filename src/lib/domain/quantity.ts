import { gramsPerVolumeUnit } from './portions';
import { canonicalUnit, isVolumeUnit, type CanonicalUnit } from './unit-spellings';
import type { Food, ProposedItem, UnitSystem } from './types';
import { formatServingMass } from './units';

/**
 * What the app can do with the unit a person typed in front of a food.
 *
 * `serving` covers a bare number and the per-item words ("2 slices", "1 scoop"):
 * one of those is one catalog serving, so the number carries straight through.
 * `mass` resolves against the food's own serving weight, which every `Food`
 * carries as `grams`. `volume` resolves only against the food itself: a cup of
 * milk and a cup of flour are different masses, so `portions.ts` reads the
 * weight off the food's own portion rows or its own serving label, and a food
 * that names neither still has its volume reported back rather than guessed at.
 */
export type QuantityKind = 'serving' | 'mass' | 'volume';

const OUNCE = 28.349523125;
const POUND = 453.59237;

/** The canonical units `isVolumeUnit` says are not a volume. */
type MassUnit = Exclude<CanonicalUnit, 'tsp' | 'tbsp' | 'cup' | 'ml' | 'l'>;

/**
 * Grams in one of each unit of mass `unit-spellings.ts` converts to a canonical
 * unit. Units of volume hold no entry here: their weight is a property of the
 * food rather than of the unit, so `portions.ts` reads it off the food
 * instead. Mass conversions are exact by definition of the international pound.
 */
const UNIT_GRAMS: Record<MassUnit, number> = {
	g: 1,
	kg: 1000,
	oz: OUNCE,
	lb: POUND
};

export type QuantitySpec = {
	/** The number the person typed. */
	amount: number;
	/** The unit as typed, lowercased. Empty when they gave a bare number. */
	unit: string;
	kind: QuantityKind;
};

export type ResolvedQuantity = {
	/** Servings to record. */
	servings: number;
	/** The quantity the app would not act on, or `null` when it took it as typed. */
	declined: QuantitySpec | null;
};

/**
 * A serving weight to divide by, and whatever the food says about volume.
 * Everything past `grams` is optional, so a caller resolving a mass need hold
 * no more of a catalog row than it did before.
 */
type ServingWeight = Pick<Food, 'grams'> & Partial<Pick<Food, 'servingLabel' | 'portions'>>;

export function classifyUnit(unit: string): QuantityKind {
	const canonical = canonicalUnit(unit);
	if (canonical === null) return 'serving';
	return isVolumeUnit(canonical) ? 'volume' : 'mass';
}

/**
 * Two decimals is the precision the serving stepper itself works in, so a parsed
 * count and a tapped one stay the same kind of number. A quantity too small to
 * survive that rounding keeps its value: recording zero would log nothing at all.
 */
function roundServings(n: number): number {
	const rounded = Math.round(n * 100) / 100;
	return rounded > 0 ? rounded : n;
}

/**
 * The grams a quantity comes to, or `null` when the food does not say.
 *
 * A mass is arithmetic on the unit alone. A volume is arithmetic on the food:
 * only the food knows what one of its cups weighs, and `null` is the answer
 * when it has never been told.
 */
function gramsTyped(spec: QuantitySpec, food: ServingWeight | null | undefined): number | null {
	if (spec.kind === 'volume') {
		const perUnit = gramsPerVolumeUnit(spec.unit, food);
		return perUnit === null ? null : spec.amount * perUnit;
	}
	const unit = canonicalUnit(spec.unit);
	// `classifyUnit` only ever produces `kind: 'mass'` for a unit it has already
	// canonicalized into one of `UNIT_GRAMS`'s keys, so this guard exists for a
	// `QuantitySpec` built by hand with a `kind` its own `unit` disagrees with —
	// treated as one gram per unit rather than thrown away.
	if (unit === null || isVolumeUnit(unit)) return spec.amount;
	return spec.amount * UNIT_GRAMS[unit];
}

export function resolveQuantity(
	spec: QuantitySpec,
	food: ServingWeight | null | undefined
): ResolvedQuantity {
	// Anything the app will not act on records one serving — the smallest thing it
	// can defend — and comes back named, so the person sees it before committing.
	const declined: ResolvedQuantity = { servings: 1, declined: spec };
	if (!Number.isFinite(spec.amount)) return declined;
	if (spec.kind === 'serving') return { servings: spec.amount, declined: null };
	// Guards the division: an absent, zero, negative or non-finite serving weight
	// would otherwise yield Infinity or NaN servings and log a meaningless entry.
	const perServing = food?.grams ?? 0;
	if (!Number.isFinite(perServing) || perServing <= 0) return declined;
	const grams = gramsTyped(spec, food);
	if (grams === null) return declined;
	return { servings: roundServings(grams / perServing), declined: null };
}

/** Trims a count to something readable without pretending to precision it lacks. */
function formatCount(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}

/**
 * One line saying what will be logged, in servings and in the person's own unit
 * of mass, so the reading is visible before the entry is committed. A declined
 * unit is named rather than converted, and nothing is promised about it.
 *
 * The mass is read in `units` because this line sits directly under the portion
 * `describePortion` renders (#74): telling someone reading in imperial that a
 * cup is "8.6 oz" and then that it was recorded as "244 g" would answer the
 * question in the system they did not choose.
 */
export function describeRecorded(
	servings: number,
	food: ServingWeight | null | undefined,
	declined: QuantitySpec | null,
	units: UnitSystem
): string {
	const perServing = food?.grams ?? 0;
	const mass =
		Number.isFinite(perServing) && perServing > 0
			? ` · ${formatServingMass(servings * perServing, units)}`
			: '';
	const recorded = `${formatCount(servings)} ${servings === 1 ? 'serving' : 'servings'}${mass}`;
	if (!declined) return recorded;
	return `Couldn’t use “${formatCount(declined.amount)} ${declined.unit}” — recorded as ${recorded}`;
}

/** A proposal that remembers the quantity it was parsed from. */
export type QuantifiedItem = ProposedItem & { quantity?: QuantitySpec | undefined };

/**
 * Points a proposal at a catalog food, re-reading the typed quantity against it.
 * A mass typed against text the parser could not match has no serving weight to
 * divide by until this moment, so the reading has to be taken again here.
 */
export function matchToFood(item: QuantifiedItem, food: Food): QuantifiedItem {
	const servings = item.quantity ? resolveQuantity(item.quantity, food).servings : item.servings;
	return { ...item, foodId: food.id, name: food.name, confidence: 1, servings };
}

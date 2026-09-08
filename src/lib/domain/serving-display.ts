/**
 * What a portion reads as, in the system the person set.
 *
 * `Food.servingLabel` is free text from whatever source supplied it, so the
 * catalog mixes systems the way its sources do: `1 large`, `1 cup`, `100 g`,
 * `1 oz (23 nuts)`, `170 g cup`. No preference can rewrite that text, and
 * nothing here tries to. The rule instead (issue #74) is:
 *
 * **Show the source label, and append the canonical mass in the person's
 * system whenever the label does not already state a mass in that system.**
 *
 * The label stays because it is the only thing that keeps the portion
 * identifiable — someone who picked a cup wants to read "1 cup", not "244 g"
 * alone. The appended mass is the food's own `grams`, or the mass the label
 * itself states, so nothing is invented. A volume is never invented from a
 * mass: there is no density here, and a cup of milk and a cup of flour weigh
 * differently. The millilitres a label can gain are `withVolumeHint`'s, and
 * they are the unit's own definition rather than the food's.
 *
 * A label that already states a mass in the reader's system is shown alone, so
 * nothing reads "100 g · 100 g". That test is put to the units the label names,
 * not to a substring: `1 scoop (30 g)` and `170 g cup` both state grams and
 * must not be doubled, while `1 cup (8 oz)` states ounces and must be.
 */

import { withVolumeHint } from './portions';
import type { UnitSystem } from './types';
import { canonicalUnit } from './unit-spellings';
import { formatServingMass, ozToG } from './units';

/**
 * What one of each mass unit weighs, and which system it belongs to — the
 * pairing is the whole question #74 asks of a label. The imperial weights go
 * through `units.ts` rather than carrying a factor of their own, because that
 * module is the only place in the app a mass is converted; `g` and `kg` are a
 * decimal prefix, not a conversion. A unit that is not in here — every volume,
 * and every word that names no unit at all — states no mass, so there is no
 * separate guard for one.
 */
const MASS = new Map<string, { grams: number; system: UnitSystem }>([
	['g', { grams: 1, system: 'metric' }],
	['kg', { grams: 1000, system: 'metric' }],
	['oz', { grams: ozToG(1), system: 'imperial' }],
	['lb', { grams: ozToG(16), system: 'imperial' }]
]);

/**
 * Every "<count> <word>" a label states, wherever it sits: `100 g`, the `30 g`
 * inside `1 scoop (30 g)`, the leading `170 g` of `170 g cup`, and the `30g` a
 * source wrote without its space. A word with no count in front of it is not a
 * measurement — `cup` in `170 g cup` names what the 170 g fills, not a second
 * quantity.
 *
 * The count has to start a label or follow something that is not part of a
 * number, which is what keeps `1/2 lb` from being read as two pounds. A
 * fraction is refused outright rather than parsed: no catalog label has ever
 * weighed a serving in halves of a pound, and reading one wrongly would log
 * four times the food.
 */
const MEASURE = /(?:^|[^\d./])(\d+(?:\.\d+)?)\s*([a-z]+)/gi;

/** What a food or a logged entry knows about its own portion. */
export type PortionSource = {
	servingLabel: string;
	/** The canonical mass of one serving, when the holder kept it. */
	grams?: number | undefined;
};

/** A mass a display can be trusted to: finite and above zero. */
function isWeight(grams: number): boolean {
	return Number.isFinite(grams) && grams > 0;
}

/** The mass a label states outright, and the system it states it in. */
export function statedMass(label: string): { grams: number; system: UnitSystem } | null {
	for (const match of label.matchAll(MEASURE)) {
		// `String(null)` is "null", which is no unit's name, so a word this app
		// does not know falls out of the table without a guard of its own.
		const mass = MASS.get(String(canonicalUnit(String(match[2]))));
		if (mass === undefined) continue;
		const grams = Number(match[1]) * mass.grams;
		if (isWeight(grams)) return { grams, system: mass.system };
	}
	return null;
}

/**
 * The mass of one serving: the food's own `grams` first, then whatever the
 * label states, and `null` when neither says. The food's number wins because it
 * is the one the calories were scaled from; a logged entry carries its
 * serving weight via `scaleFood` (PR #251), so logged and search rows use the same basis.
 */
export function servingMassGrams(source: PortionSource): number | null {
	// `Number(undefined)` is `NaN`, which `isWeight` refuses, so a source that
	// kept no weight needs no guard separate from one whose weight is unusable.
	const grams = Number(source.grams);
	if (isWeight(grams)) return grams;
	const stated = statedMass(source.servingLabel);
	return stated === null ? null : stated.grams;
}

/**
 * A count without the noise of floating-point arithmetic behind it. Two decimal
 * places, the precision the serving stepper itself works in.
 */
function formatServings(servings: number): string {
	return String(Math.round(servings * 100) / 100);
}

/**
 * The whole portion phrase for `servings` of a food, in the reader's system:
 * `1 cup (240 ml) · 244 g`, `2 × 1 cup (240 ml) · 488 g`, `100 g · 3.5 oz`.
 *
 * The count leads the phrase and the mass closes it, so the label is written
 * once and the multiplication is unambiguous — never `2 × 1 cup` glued to a
 * second copy of itself, and never a mass that could be read as belonging to
 * one serving when it belongs to two.
 */
export function describePortion(
	source: PortionSource,
	servings: number,
	units: UnitSystem
): string {
	const label = withVolumeHint(source.servingLabel);
	const head = servings === 1 ? label : `${formatServings(servings)} × ${label}`;
	if (statedMass(source.servingLabel)?.system === units) return head;
	// `Number(null)` is 0, which `isWeight` refuses: a serving nothing knows the
	// weight of is shown as the label alone rather than guarded for separately.
	const total = Number(servingMassGrams(source)) * servings;
	return isWeight(total) ? `${head} · ${formatServingMass(total, units)}` : head;
}

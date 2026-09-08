/**
 * "Whole pack" as a quantity the log sheet can offer (#158).
 *
 * Nothing in the catalog carries a `package_grams` column, and inventing one
 * would mean the ETL guessing at what a bag holds. What the sources do give,
 * for a packaged food, is a serving row naming the package itself — "1 bag",
 * "1.0 container", "1 bottle" — with the weight beside it. #246 already
 * carries those rows to the client as `Food.servingOptions`, verbatim, so the
 * package mass is known exactly when the source named it and unknown when it
 * did not. This module is the reading of those rows, and nothing else.
 *
 * The count is required to be exactly one, the same way `unit-measure.ts`
 * requires it (#178) and for the same reason: "6 bags" is the weight of six,
 * and offering it as "whole pack" would log six times the food.
 */

import { servingMassGrams, type PortionSource } from './serving-display';

/**
 * The nouns that name a package rather than a portion of one.
 *
 * Overlaps `unit-measure.ts`'s countable nouns on `can`, `bottle` and
 * `container` on purpose: for a drink or a tub, the countable item and the
 * package are the same object, and both readings of it are correct.
 */
const PACK_NOUNS = [
	'package',
	'pack',
	'bag',
	'box',
	'carton',
	'pouch',
	'tub',
	'jar',
	'bottle',
	'can',
	'container'
] as const;

/** "1 bag", "1.0 package (155 g)" — a count of exactly one, then a package noun. */
const SINGLE_PACK = new RegExp(`^1(?:\\.0+)?\\s+(?:${PACK_NOUNS.join('|')})\\b`, 'i');

/** What this module needs of a food: its serving, and the choices its source named. */
export type PackagedSource = PortionSource & {
	servingOptions?: readonly { label: string; grams: number }[] | undefined;
};

function namesAPack(option: { label: string; grams: number }): boolean {
	return SINGLE_PACK.test(option.label.trim()) && Number.isFinite(option.grams) && option.grams > 0;
}

/**
 * The mass of the whole package, or `null` when the source never said.
 *
 * A package weighing exactly what one serving weighs answers `null` as well:
 * a single-serve bag is already the default amount, and offering "whole pack"
 * beside it would be a second button that changes nothing.
 */
export function wholePackGrams(food: PackagedSource): number | null {
	const option = (food.servingOptions ?? []).find(namesAPack);
	if (option === undefined) return null;
	return option.grams === servingMassGrams(food) ? null : option.grams;
}

import { UNIT_ML, type Portion } from './portions';
import type { Food, NutrientBasis, Provenance } from './types';
import { ZERO_MICROS } from './types';
import { round1 } from './utils';

/**
 * The server catalog's side of a scanned barcode, and how it becomes a `Food`
 * the rest of the app can propose, scale and log.
 *
 * The wire shape is declared here rather than imported from
 * `src/lib/server/catalog/foods.ts`: that module opens `node:sqlite` and never
 * reaches the browser. What travels between them is the JSON contract, and
 * `isCatalogFoodPayload` is where this side decides it received it.
 */

/** Fourteen digits is the longest barcode the catalog stores; eight the shortest a package carries. */
const BARCODE = /^\d{8,14}$/;

/**
 * The digits of a barcode, or `null` when the text is not one.
 *
 * Only whitespace is stripped, exactly as `FoodSearch.svelte` does it: removing
 * every non-digit instead would read "6026521710a2" as a barcode by throwing
 * the "a" away, and look up a code the person never scanned.
 */
export function normalizeBarcode(raw: string): string | null {
	const digits = raw.replace(/\s/g, '');
	return BARCODE.test(digits) ? digits : null;
}

/**
 * One catalog row as `/api/foods/barcode` sends it: everything a log entry
 * needs. `CatalogFood` in `src/lib/server/catalog/foods.ts` is this plus the
 * two ranking columns the client has no use for, so the contract has one
 * definition and cannot drift between the two sides of the wire.
 */
export type CatalogFoodPayload = {
	id: number;
	name: string;
	brand: string | null;
	kind: string;
	category: string | null;
	barcode: string | null;
	license: string;
	serving: { label: string | null; grams: number | null };
	/**
	 * What one of each volume unit weighs for this food, read off the catalog's
	 * `food_serving` rows. Optional: a deployment without the portions query, or
	 * a food the catalog gave no household measure for, simply sends none.
	 */
	portions?: readonly Portion[] | undefined;
	/**
	 * The usable unit measure the catalog's `food_serving` rows named for this
	 * food, when one of them named a genuine single countable item rather than
	 * a mass, a volume, or a per-serving piece count (#178). Absent — not
	 * `null` — when none did, so a food like Oreo, which the core catalog
	 * carries only as "100 g", sends no key rather than one that has to be
	 * checked for `null` on every food.
	 */
	unit?: { label: string; grams: number } | undefined;
	/**
	 * The serving choices the catalog's `food_serving` rows named for this
	 * food — MyFitnessPal-style "4.0 oz", "1.0 medium breast", "100 g" — kept
	 * verbatim rather than reinterpreted the way `portions` and `unit` are.
	 * Absent, not an empty list, when the catalog named none: same reasoning
	 * as `portions`.
	 */
	servingOptions?: readonly { label: string; grams: number }[] | undefined;
	/** Per 100 g or 100 ml, which is how the catalog stores every nutrient. */
	per100g: NutrientBasis;
};

function isText(value: unknown): boolean {
	return typeof value === 'string';
}

function isOptionalText(value: unknown): boolean {
	return value === null || isText(value);
}

function isOptionalNumber(value: unknown): boolean {
	return value === null || typeof value === 'number';
}

/**
 * A parsed JSON value as something the checks below can read columns off.
 *
 * There is deliberately no "is this an object" test here: a string, a number or
 * an array answers `undefined` to every column, which is already a rejection.
 * Only `null` and `undefined` would throw on access, so they are the only
 * things swapped out — anything more would be a guard whose removal no input
 * could detect.
 */
function fieldsOf(value: unknown): Record<string, unknown> {
	return (value ?? {}) as Record<string, unknown>;
}

/** Who the row is: the columns the person reads off the proposal. */
function namesAFood(row: Record<string, unknown>): boolean {
	return (
		typeof row.id === 'number' &&
		isText(row.name) &&
		isText(row.kind) &&
		isText(row.license) &&
		isOptionalText(row.brand) &&
		isOptionalText(row.category) &&
		isOptionalText(row.barcode)
	);
}

/**
 * One household measure. A unit outside the table would be a unit no client can
 * convert, so it is a rejection rather than a value carried through unread.
 */
function namesAPortion(value: unknown): boolean {
	const portion = fieldsOf(value);
	return (
		typeof portion.unit === 'string' &&
		Object.hasOwn(UNIT_ML, portion.unit) &&
		typeof portion.grams === 'number'
	);
}

/**
 * The household measures, when the payload carries any. Absent is valid — the
 * field was added after the contract — but present and malformed is not.
 */
function namesPortions(value: unknown): boolean {
	if (value === undefined) return true;
	return Array.isArray(value) && value.every(namesAPortion);
}

/** The serving the nutrients will be scaled onto. */
function namesAServing(serving: Record<string, unknown>): boolean {
	return isOptionalNumber(serving.grams) && isOptionalText(serving.label);
}

/**
 * The usable unit measure, when the payload carries one. Absent is valid —
 * most foods name none — but present and malformed is not.
 */
function namesAUnit(value: unknown): boolean {
	if (value === undefined) return true;
	const unit = fieldsOf(value);
	return typeof unit.label === 'string' && typeof unit.grams === 'number';
}

/**
 * One serving choice. `fieldsOf` rather than a direct property read, the same
 * as `namesAPortion`, so a prototype-polluting key (`__proto__`, `toString`)
 * reads as "no such field" instead of reaching whatever `Object.prototype`
 * already carries under that name.
 */
function namesAServingOption(value: unknown): boolean {
	const option = fieldsOf(value);
	return typeof option.label === 'string' && typeof option.grams === 'number';
}

/**
 * The serving choices, when the payload carries any. Absent is valid — the
 * field was added after the contract, and most deployments and most foods
 * send none — but present and malformed is not, matching `namesPortions`.
 */
function namesServingOptions(value: unknown): boolean {
	if (value === undefined) return true;
	return Array.isArray(value) && value.every(namesAServingOption);
}

/**
 * The nutrients. `kcal` must be a number: a row without energy would log as a
 * zero-calorie line and quietly wrong the day's total, which is worse than
 * saying the catalog could not be read.
 */
const SCALED_NUTRIENTS = ['protein', 'fat', 'carbs', 'sugar', 'fiber', 'sodium'];

/**
 * The nine micros #175 adds. Unlike `SCALED_NUTRIENTS`, absent is accepted as
 * well as `null` — every payload written before this change omits them
 * entirely, and that has to keep reading as "the catalog said nothing" rather
 * than becoming a rejection.
 */
const NEW_MICROS =
	'potassium iron calcium magnesium zinc vitaminA vitaminC vitaminD vitaminB12'.split(' ');

function carriesNutrients(per100g: Record<string, unknown>): boolean {
	if (typeof per100g.kcal !== 'number') return false;
	return (
		SCALED_NUTRIENTS.every((n) => isOptionalNumber(per100g[n])) &&
		NEW_MICROS.every((n) => per100g[n] === undefined || isOptionalNumber(per100g[n]))
	);
}

/** Whether a parsed body is a catalog row this side can log. */
export function isCatalogFoodPayload(value: unknown): value is CatalogFoodPayload {
	const row = fieldsOf(value);
	return (
		namesAFood(row) &&
		namesAServing(fieldsOf(row.serving)) &&
		namesPortions(row.portions) &&
		namesAUnit(row.unit) &&
		namesServingOptions(row.servingOptions) &&
		carriesNutrients(fieldsOf(row.per100g))
	);
}

/**
 * A serving weight the catalog does not name is taken as 100 g, which is the
 * basis the nutrients are already on, so the numbers shown are the catalog's
 * own rather than a guess scaled by one.
 */
const PER = 100;

/**
 * The label for a serving the catalog priced by weight alone.
 *
 * The server picks a household measure — a whole item, or the first serving
 * the source gave — before it ever falls back to this, so reaching it here
 * means the catalog truly named none. "100 g" would read as a real serving
 * nobody reported; saying "per 100 g" instead is the label owning up to the
 * fallback rather than passing a guess off as a fact (#157).
 */
const NO_SERVING_LABEL = 'per 100 g';

/**
 * The badge the person sees.
 *
 * The wire names the source by license rather than by name. ODbL-1.0 is the
 * only share-alike license in the catalog and belongs to Open Food Facts (#81),
 * so it is the one source that can be identified exactly. The rest are USDA
 * (public domain) and the Canadian Nutrient File, which the wire does not tell
 * apart, so a branded row reads as a brand and a generic one as USDA.
 */
function provenanceOf(payload: CatalogFoodPayload): Provenance {
	if (payload.license === 'ODbL-1.0') return 'off';
	return payload.kind === 'branded' ? 'brand' : 'usda';
}

/**
 * The fields a `Food` carries only when the catalog actually named them: a
 * brand, a barcode, household measures, a usable unit measure, and the
 * serving options this slice adds.
 *
 * Pulled out of `catalogFoodToFood` itself rather than left as five
 * conditional spreads inline: each one is its own independent branch, not a
 * decision that depends on the others, so folding them into the function's
 * own body only inflated its cyclomatic complexity without making any of the
 * branches easier to read.
 */
function optionalFields(payload: CatalogFoodPayload) {
	return {
		...(payload.brand === null ? {} : { brand: payload.brand }),
		...(payload.barcode === null ? {} : { barcode: payload.barcode }),
		// Dropped when empty rather than carried as an empty array: `undefined` is
		// what every bundled food says, so a catalog food that named no measure
		// reads the same as one that never could.
		...(payload.portions?.length ? { portions: payload.portions } : {}),
		// Dropped when absent, the same as `portions`: a bundled food never has
		// one either, and the toggle this backs (#178) reads its absence as "no
		// usable unit" either way.
		...(payload.unit ? { unit: payload.unit } : {}),
		// Carried, not yet acted on: this slice only moves the wire field onto
		// the domain type. Dropped when empty, the same as `portions` and
		// `unit`, so a bundled food and a catalog food naming no choices read
		// the same.
		...(payload.servingOptions?.length ? { servingOptions: payload.servingOptions } : {})
	};
}

/** A catalog row as a `Food`: per-100 g nutrients scaled onto one serving. */
export function catalogFoodToFood(payload: CatalogFoodPayload): Food {
	const grams = payload.serving.grams ?? PER;
	const per = payload.per100g;
	const factor = grams / PER;
	const scaled = (value: number | null | undefined) => round1((value ?? 0) * factor);
	return {
		// Prefixed because it is not a bundled food id and must never resolve as
		// one. The catalog's own number is a hint the ETL does not promise to
		// keep, so nothing is stored against it: `logFromCatalogFood` logs a
		// null `foodId` and the entry carries its own name and macros instead.
		id: `catalog-${payload.id}`,
		name: payload.name,
		aliases: [],
		category: payload.category ?? 'other',
		provenance: provenanceOf(payload),
		servingLabel:
			payload.serving.label ?? (payload.serving.grams === null ? NO_SERVING_LABEL : `${grams} g`),
		grams,
		...optionalFields(payload),
		kcal: Math.round(per.kcal * factor),
		protein: scaled(per.protein),
		carbs: scaled(per.carbs),
		fat: scaled(per.fat),
		micros: {
			...ZERO_MICROS,
			fiber: scaled(per.fiber),
			sugar: scaled(per.sugar),
			sodium: scaled(per.sodium),
			potassium: scaled(per.potassium),
			iron: scaled(per.iron),
			calcium: scaled(per.calcium),
			magnesium: scaled(per.magnesium),
			zinc: scaled(per.zinc),
			vitaminA: scaled(per.vitaminA),
			vitaminC: scaled(per.vitaminC),
			vitaminD: scaled(per.vitaminD),
			vitaminB12: scaled(per.vitaminB12)
		},
		// Unscaled and nulls kept as `null`: `nutritionFactsRows` (#175) is the
		// one reader that needs the catalog's own gaps rather than this food's
		// zeroed convenience numbers.
		per100g: per
	};
}

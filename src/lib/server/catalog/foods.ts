import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { CatalogFoodPayload } from '$lib/domain/catalog-food';
import { text } from '../users/rows';
import { withDefaultServing } from './default-serving';
import { withPortions } from './portions';
import { searchTerms, singular } from './query';
import { searchSql } from './ranking';
import { prepared } from './statements';

/** Default page size for a search; the client shows a handful and scrolls. */
const DEFAULT_LIMIT = 20;

/** Ceiling on the page size, so a caller cannot ask for the whole catalog. */
const MAX_LIMIT = 50;

/** Read once, by both queries, so the row shape has a single definition. */
const FOOD_COLUMNS = `f.food_id, f.name, f.brand, f.kind, f.category, f.gtin14, f.license,
	f.serving_label, f.serving_g, f.kcal, f.protein, f.fat, f.carbs, f.sugar, f.fiber,
	f.sodium, f.saturated_fat, f.potassium, f.iron, f.calcium, f.magnesium, f.zinc,
	f.vitamin_a, f.vitamin_c, f.vitamin_d, f.vitamin_b12, f.quality, f.n_sources`;

/**
 * One catalog row as the client sees it.
 *
 * `id` is `food_id`, and it is a hint, not a key: the ETL rebuilds the catalog
 * wholesale and does not promise the number survives. A logged entry keeps this
 * whole snapshot, which is why the nutrients and the `license` travel with it
 * rather than being fetched again later.
 */
export type CatalogFood = CatalogFoodPayload & {
	quality: number;
	sources: number;
};

type Row = Record<string, SQLOutputValue>;

/** A nullable text column: null stays null rather than becoming the string "null". */
function optionalText(row: Row, column: string): string | null {
	const value = row[column];
	return typeof value === 'string' ? value : null;
}

/** A nullable numeric column. A column that has changed shape reads as absent, not as `NaN`. */
function optionalNumber(row: Row, column: string): number | null {
	const value = row[column];
	return typeof value === 'number' ? value : null;
}

/** A column that must carry a number. Refuses to guess, the same way `rows.ts` does for text. */
function requiredNumber(row: Row, column: string): number {
	const value = optionalNumber(row, column);
	if (value === null) throw new TypeError(`expected a number in column "${column}"`);
	return value;
}

function toFood(row: Row): CatalogFood {
	return {
		id: requiredNumber(row, 'food_id'),
		name: text(row, 'name'),
		brand: optionalText(row, 'brand'),
		kind: text(row, 'kind'),
		category: optionalText(row, 'category'),
		barcode: optionalText(row, 'gtin14'),
		license: text(row, 'license'),
		serving: {
			label: optionalText(row, 'serving_label'),
			grams: optionalNumber(row, 'serving_g')
		},
		per100g: {
			kcal: requiredNumber(row, 'kcal'),
			protein: optionalNumber(row, 'protein'),
			fat: optionalNumber(row, 'fat'),
			carbs: optionalNumber(row, 'carbs'),
			sugar: optionalNumber(row, 'sugar'),
			fiber: optionalNumber(row, 'fiber'),
			sodium: optionalNumber(row, 'sodium'),
			saturatedFat: optionalNumber(row, 'saturated_fat'),
			potassium: optionalNumber(row, 'potassium'),
			iron: optionalNumber(row, 'iron'),
			calcium: optionalNumber(row, 'calcium'),
			magnesium: optionalNumber(row, 'magnesium'),
			zinc: optionalNumber(row, 'zinc'),
			vitaminA: optionalNumber(row, 'vitamin_a'),
			vitaminC: optionalNumber(row, 'vitamin_c'),
			vitaminD: optionalNumber(row, 'vitamin_d'),
			vitaminB12: optionalNumber(row, 'vitamin_b12')
		},
		quality: requiredNumber(row, 'quality'),
		sources: requiredNumber(row, 'n_sources')
	};
}

/** Clamp a requested page size into 1..`MAX_LIMIT`; anything unusable falls back to the default. */
export function pageSize(requested: string | null): number {
	const parsed = Number(requested);
	if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
	return Math.min(parsed, MAX_LIMIT);
}

/**
 * The ranked matches for what a person typed. An empty query is not an error:
 * it has no matches, which is what the first keystroke should show.
 */
export function searchFoods(db: DatabaseSync, typed: string, limit: number): CatalogFood[] {
	const terms = searchTerms(typed);
	if (terms === null) return [];
	const found = prepared(db, searchSql(FOOD_COLUMNS))
		.all({
			match: terms.match,
			text: terms.text,
			singular: singular(terms.text),
			prefix: `${singular(terms.text)}%`,
			limit
		})
		.map(toFood);
	return finish(db, found);
}

/**
 * Every food carrying this GTIN-14. Plural on purpose: the ETL's own validation
 * reports 30 duplicate barcodes, and answering with one of them would log the
 * wrong food silently. The caller is handed all of them and has to choose.
 */
export function foodsByBarcode(db: DatabaseSync, barcode: string): CatalogFood[] {
	const found = prepared(
		db,
		`select ${FOOD_COLUMNS} from food f where f.gtin14 = ? order by f.quality desc`
	)
		.all(barcode)
		.map(toFood);
	return finish(db, found);
}

/**
 * The two reads every found row still needs before it can travel: its
 * household measures, and — for the rows the source gave no serving of its
 * own — the default this catalog picks in its place. One place to call both,
 * so search results and `/api/foods/resolve` (which calls `searchFoods`
 * itself) can never see one without the other.
 */
function finish(db: DatabaseSync, found: CatalogFood[]): CatalogFood[] {
	return withDefaultServing(db, withPortions(db, found));
}

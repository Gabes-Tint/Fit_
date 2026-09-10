// The extension is explicit for the same reason `ranking.ts` gives: this module
// is imported by `scripts/eval/search-eval.ts` under plain Node, which will not
// resolve a specifier that omits it.
import { searchTerms, type SearchTerms } from './query.ts';

/**
 * The two rules that separate a plain food from a brand whose label spells it.
 *
 * "green apple" was logged as Claeys hard candy at 400 kcal (#337). Two things
 * were wrong at once and neither is fixable by the other's rule.
 *
 * The first is scoring: a branded row named exactly "GREEN APPLE" collects every
 * name term and the whole brevity term, which no generic row written "Apples,
 * granny smith, with skin, raw" can ever match. So a branded row whose brand the
 * query does not name is demoted — a person who types a brand gets that brand,
 * and a person who types a food gets the food.
 *
 * The second is matching, and it is why the demotion alone is not enough: the
 * catalog holds no generic row carrying both "green" and "apple", so the strict
 * AND match for "green apple" is 859 rows of which every single one is branded.
 * Nothing can be re-ranked into first place that is not in the match set. When a
 * page comes back branded from end to end and names no brand, the query is read
 * again on its head noun alone, and the two pages are merged on their scores.
 */

/** A ranked row, as these rules need to see it. */
export type RankedRow = {
	id: number;
	brand: string | null;
	kind: string;
};

/**
 * One ranked row and whatever its caller wanted out of it.
 *
 * The payload is carried beside the ranking fields rather than merged into them
 * so that nothing here has to know what a food looks like, and so the score —
 * which exists only to compare two pages with each other — never has to be
 * peeled back off the object a caller returns to its own callers.
 */
export type Ranked<Food> = RankedRow & { score: number; food: Food };

/** The catalog's word for a row that is a food rather than a product. */
const GENERIC_KIND = 'generic';

/**
 * Whether the typed text names this brand.
 *
 * Substring rather than token equality, because a brand is written as one label
 * ("BURGER KING", "TRADER JOE'S") and a person types it that way. Folded to
 * lower case on both sides; the text arrives already folded from `searchTerms`.
 *
 * A brand shorter than a token floor is ignored rather than matched: two-letter
 * brands exist in the catalog and would exempt half the branded rows from the
 * demotion by appearing inside an unrelated word.
 */
export function namesBrand(text: string, brand: string | null): boolean {
	if (brand === null) return false;
	const folded = brand.trim().toLowerCase();
	if (folded.length < MIN_BRAND_LENGTH) return false;
	return text.includes(folded);
}

/**
 * How short a brand may be and still exempt its row from the demotion. Three,
 * the same floor `query.ts` puts on a typed token, and for the same reason: a
 * shorter string matches too much to mean anything.
 */
const MIN_BRAND_LENGTH = 3;

/**
 * Whether a page has answered a plain-food query with branded products only.
 *
 * Three conditions, and all three are needed. The page must hold no generic row,
 * or there was a food to rank and the demotion's job was to lift it. It must
 * name no brand, or the person asked for a product and got one — this is what
 * keeps "burger king whopper" and "subway turkey" reading their own rows. And
 * the query must have a qualifier to drop, since a single token has no head to
 * fall back to.
 *
 * An empty page is not retried. Answering nothing is a different problem from
 * answering the wrong thing, and widening a query that matched nothing would
 * change what "no results" means.
 */
export function needsHeadRetry(text: string, page: readonly RankedRow[]): boolean {
	if (page.length === 0) return false;
	if (headWord(text) === null) return false;
	return !page.some((row) => row.kind === GENERIC_KIND || namesBrand(text, row.brand));
}

/**
 * The head noun of a multi-token query, or `null` when there is not one.
 *
 * The last token, because English puts the head of a food phrase last: "green
 * apple" is an apple, "red onion" an onion, "greek yogurt" a yogurt. It is a
 * heuristic and it is wrong for a compound like "peanut butter" — which is why
 * it runs only when `needsHeadRetry` has already found the page hopeless, and
 * "peanut butter" answers with generic peanut butter and never reaches it.
 */
function headWord(text: string): string | null {
	const tokens = text.split(' ').filter((token) => token.length > 0);
	return tokens.length > 1 ? (tokens[tokens.length - 1] ?? null) : null;
}

/** The head noun read as its own query, or `null` when there is no head to read. */
export function headTerms(text: string): SearchTerms | null {
	const head = headWord(text);
	return head === null ? null : searchTerms(head);
}

/**
 * The strict page, or the strict and head-only pages merged, ordered by score.
 *
 * Merged rather than replaced: the candy is still a real answer to "green
 * apple" and a person looking for it has to be able to find it. Both pages are
 * scored by the same formula, so the scores compare; a row reached by both keeps
 * the higher of the two, since being found twice is not a reason to rank lower.
 *
 * `run` is the caller's ranked query, which is what lets the eval runner and the
 * search endpoint share this decision instead of reimplementing it apart.
 */
export function searchPlainFood<Food>(
	terms: SearchTerms,
	limit: number,
	run: (terms: SearchTerms, limit: number) => Ranked<Food>[]
): Food[] {
	const strict = run(terms, limit);
	const relaxed = needsHeadRetry(terms.text, strict) ? headTerms(terms.text) : null;
	if (relaxed === null) return strict.map((row) => row.food);
	const best = new Map<number, Ranked<Food>>();
	for (const row of [...strict, ...run(relaxed, limit)]) {
		const held = best.get(row.id);
		if (held === undefined || row.score > held.score) best.set(row.id, row);
	}
	return [...best.values()]
		.sort((left, right) => right.score - left.score)
		.slice(0, limit)
		.map((row) => row.food);
}

/**
 * `namesBrand`, in SQL, as the demotion `ranking.ts` weights: 1.0 for a branded
 * row whose brand the query does not name, 0.0 for everything else.
 *
 * Only `kind = 'branded'` is demoted, named explicitly rather than as "not
 * generic", so a catalog that grows a third kind is left alone until someone
 * decides what it means. The two forms are kept in one file because they are one
 * rule and a difference between them would be a silent ranking bug.
 */
export function unnamedBrandSql(): string {
	// `coalesce`, and not because null is tidier: 4% of the catalog's branded
	// rows carry no brand at all, and a bare `f.brand` makes the whole predicate
	// null for them, which `case when` reads as false and exempts from the
	// demotion. A row with no brand is the one row a query can never be naming.
	const brand = "lower(trim(coalesce(f.brand, '')))";
	return `case when f.kind = 'branded'
			and not (length(${brand}) >= ${MIN_BRAND_LENGTH} and instr(:text, ${brand}) > 0)
		then 1.0 else 0.0 end`;
}

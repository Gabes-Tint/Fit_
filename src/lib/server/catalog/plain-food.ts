// The extension is explicit for the same reason `ranking.ts` gives: this module
// is imported by `scripts/eval/search-eval.ts` under plain Node, which will not
// resolve a specifier that omits it.
import { searchTerms, type SearchTerms } from './query.ts';

/**
 * Two rules that keep a brand from answering for the food it is named after.
 *
 * "green apple" logged Claeys hard candy at 400 kcal (#337). A branded row
 * named exactly what a person types collects every name term and the whole of
 * the brevity term, which no generic row written "Apples, granny smith, with
 * skin, raw" can reach. So a branded row whose brand the query does not name is
 * demoted, and a person who types a brand still gets that brand.
 *
 * The second rule is narrower than it first looks, and deliberately so. The
 * catalog holds no generic row carrying both "green" and "apple", so the strict
 * match for that query is 948 rows of which every one is branded, and the first
 * instinct — read the query again on its head noun and merge the two pages by
 * score — is a worse bug than the one it fixes. Measured on the live catalog:
 * "cauliflower rice" (300 matches, none generic) then answers with black rice
 * at 360 kcal in place of a 24 kcal vegetable, "zucchini noodles" with chow
 * mein at 471 against 18, "chickpea pasta" and "cashew cheese" the same way.
 * A compound food is written exactly like a plain food with a modifier, and
 * nothing in a name, a brand or a kind tells the two apart.
 *
 * So the widened page is never allowed to outrank the strict one. It fills the
 * tail of a page the strict match could not fill, and nothing more: the branded
 * cauliflower rice keeps the top of its own query, and the head noun's foods
 * come after it instead of an empty page. What that does not do is put a fruit
 * above the candy for "green apple" — no rule here can, because that judgement
 * is about food and not about text.
 */

/** A ranked row, as these rules need to see it. */
export type RankedRow = {
	id: number;
	brand: string | null;
	kind: string;
};

/**
 * One ranked row and whatever its caller wanted out of it. The payload rides
 * beside the ranking fields so that nothing here has to know what a food is.
 */
export type Ranked<Food> = RankedRow & { food: Food };

/** The catalog's word for a row that is a food rather than a product. */
const GENERIC_KIND = 'generic';

/**
 * The text with a space on either end, so a token can be looked for with its
 * boundaries. `searchTerms` joins its tokens with single spaces and strips
 * everything that is not a letter or a digit, so this is a complete tokenizing
 * for the query side.
 */
function padded(text: string): string {
	return ` ${text} `;
}

/**
 * Whether the typed text names this brand.
 *
 * Whole tokens, not a substring, and that is the difference between a rule and
 * a coincidence: "banana" contains "nan", "chicken breast" contains "eas" and
 * "olive oil" contains "live", and all three are real brands in the catalog.
 * A substring test exempted those rows from the demotion for a word the person
 * never typed.
 *
 * A brand is still matched as the whole label it is printed as rather than
 * token by token, because that is how a person types one: "burger king whopper"
 * names BURGER KING, and neither half of that brand on its own should count.
 *
 * `namesBrandSql` below is the same rule in SQL and the two must agree.
 */
export function namesBrand(text: string, brand: string | null): boolean {
	if (brand === null) return false;
	const folded = brand.trim().toLowerCase();
	// A brand the ETL carried through blank is not a brand a query can name.
	// The guard is not decoration: without it the padding alone would look for
	// two adjacent spaces, which a doubled space between typed words supplies.
	if (folded.length === 0) return false;
	return padded(text).includes(padded(folded));
}

/**
 * `namesBrand`, in SQL, as the demotion `ranking.ts` weights: 1.0 for a branded
 * row whose brand the query does not name, 0.0 for everything else.
 *
 * Only `kind = 'branded'` is demoted, named explicitly rather than as "not
 * generic", so a catalog that grows a third kind is left alone until somebody
 * decides what it means.
 *
 * `coalesce`, and not for tidiness: 4% of branded rows carry no brand at all,
 * and a bare `f.brand` makes the whole predicate null for them, which `case
 * when` reads as false and would exempt exactly the rows that can never be
 * named. The padding is `namesBrand`'s, so the two forms agree token for token.
 */
export function unnamedBrandSql(): string {
	const brand = "lower(trim(coalesce(f.brand, '')))";
	return `case when f.kind = 'branded'
			and not (length(${brand}) > 0
				and instr(' ' || :text || ' ', ' ' || ${brand} || ' ') > 0)
		then 1.0 else 0.0 end`;
}

/**
 * The terms a hopeless page should be widened with, or `null` to leave it alone.
 *
 * One function rather than a question and an answer, so there is exactly one
 * place that decides and no branch downstream that cannot be reached.
 *
 * An empty page is not widened: answering nothing is a different problem from
 * answering the wrong thing, and widening a query that matched nothing would
 * change what "no results" means. A page holding a food is not widened either —
 * there was something to rank and the demotion's job was to lift it — nor is
 * one whose brand the person named, which is what keeps "burger king whopper"
 * and "subway turkey" reading their own rows. And a single-token query has no
 * qualifier to drop, so there is nothing to widen it to.
 */
export function headRetryTerms(text: string, page: readonly RankedRow[]): SearchTerms | null {
	if (page.length === 0) return null;
	if (page.some((row) => row.kind === GENERIC_KIND || namesBrand(text, row.brand))) return null;
	const head = headWord(text);
	return head === null ? null : searchTerms(head);
}

/**
 * The head noun of a multi-token query, or `null` when there is not one.
 *
 * The last token, because English puts the head of a food phrase last. It is a
 * heuristic and it is wrong for a compound like "peanut butter" — which costs
 * nothing here, because what it produces can only ever sit below the rows the
 * query actually matched.
 */
function headWord(text: string): string | null {
	const tokens = text.split(' ').filter((token) => token.length > 0);
	return tokens.length > 1 ? (tokens[tokens.length - 1] ?? null) : null;
}

/**
 * The strict page, with the head noun's page appended under it when the strict
 * match could not fill the page on its own.
 *
 * Appended, never interleaved: a row the query actually matched outranks every
 * row reached by throwing one of its words away, whatever either scored. The
 * two pages are scored against different text, so comparing those scores was
 * never the comparison it looked like.
 *
 * A full page is returned without running the second query at all. That is not
 * only the ~20 ms it saves on a search: `resolveFood` reads three rows, and a
 * three-row page is nearly always full, so this is what keeps the photo and
 * resolve endpoints reading exactly the rows the query matched.
 *
 * `run` is the caller's ranked query, which is what lets the eval runner and
 * the search endpoint share this decision instead of reimplementing it apart.
 */
export function searchPlainFood<Food>(
	terms: SearchTerms,
	limit: number,
	run: (terms: SearchTerms, limit: number) => Ranked<Food>[]
): Food[] {
	const strict = run(terms, limit);
	if (strict.length >= limit) return strict.map((row) => row.food);
	const relaxed = headRetryTerms(terms.text, strict);
	if (relaxed === null) return strict.map((row) => row.food);
	const seen = new Set(strict.map((row) => row.id));
	const tail = run(relaxed, limit).filter((row) => !seen.has(row.id));
	return [...strict, ...tail].slice(0, limit).map((row) => row.food);
}

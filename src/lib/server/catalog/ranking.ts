// The extension is explicit because `scripts/eval/search-eval.ts` imports this
// module under plain Node, which does not resolve a specifier that omits its
// extension the way Vite does. `rewriteRelativeImportExtensions` rewrites it on the way
// out, so the built server sees `./byproducts.js`.
import { byproductSql, namePartsSql } from './byproducts.ts';
import { unnamedBrandSql } from './plain-food.ts';

/**
 * How a catalog row is scored against a query.
 *
 * Ordering by `quality`, which is what the ETL's own demo query does, is not a
 * ranking on this catalog: 97% of the rows are branded, the branded rows carry
 * the highest `quality`, and "milk" answers with milk chocolate pretzels, milk
 * chocolate bars and cream cheese. Every term below exists to separate the food
 * a person means from a brand whose label happens to contain the word.
 *
 * Each term is normalized to 0..1 before it is weighted, so the weights are
 * comparable to one another and no term can dominate by accident of scale. The
 * scoring runs in SQLite because it re-ranks the whole match set, not a page of
 * it: on a query like "milk" that is 15,861 rows.
 */
const RANK_WEIGHTS = {
	/** The whole name is the query. "MILK" for "milk". */
	exactName: 2,
	/**
	 * The name up to its first comma is the query. Both halves of the catalog
	 * put the food first and its qualifiers after, so this is the one term that
	 * reads "MILK" and "Milk, whole" as the same kind of hit while reading
	 * "MILK CHOCOLATE PRETZELS" as a different one.
	 */
	headName: 2,
	/** The head merely starts with the query: "Bananas, raw" for "banana". */
	headPrefix: 0.75,
	/**
	 * How much of the name the query accounts for. A short name the query nearly
	 * fills is usually the thing meant; a long branded name that merely contains
	 * the word usually is not.
	 */
	brevity: 2,
	/** `kind = 'generic'`: 3% of the catalog, and where every whole food lives. */
	generic: 1.5,
	/**
	 * A generic row from the USDA reference set rather than a survey composite.
	 * Separates "Egg, whole, raw, fresh" from "Egg, creamed"; without it the top
	 * of "egg" is prepared dishes.
	 */
	reference: 0.75,
	/**
	 * How many sources agree on the row, log-scaled. This is what lifts
	 * "Milk, whole" (247 sources) and "Chicken, ground, raw" (121) above the
	 * thousands of single-source rows beside them.
	 */
	corroboration: 1.5,
	/**
	 * Deliberately small. `quality` is the ETL's confidence in the numbers, not
	 * in the match, and on this catalog it runs the wrong way — branded rows sit
	 * at 94 and generic ones at 90. It breaks ties and nothing more.
	 */
	quality: 0.5,
	/**
	 * Subtracted. A preserved or substitute form, or a part of an animal rather
	 * than the animal, is a real food but is almost never what a bare food word
	 * means, and those rows crowd out the plain one because their names are
	 * short. One penalty rather than two: a row that is both dried and offal is
	 * still only one wrong answer.
	 */
	processedForm: 1,
	/**
	 * Subtracted. A branded row whose brand the query does not name is a product
	 * a person did not ask for. Without it "green apple" answers with Claeys
	 * hard candy at 400 kcal (#337) and "apple", "banana" and "milk" each answer
	 * with a brand that named its package after the food: a branded row spelled
	 * exactly like the query collects every name term and the whole of brevity,
	 * which no generic row written "Apples, granny smith, with skin, raw" can
	 * reach. Large enough to outweigh that exact-name advantage, and exempting a
	 * named brand so "burger king whopper" still answers with the Whopper.
	 *
	 * Measured, not guessed, and it is a ceiling rather than a preference. Over
	 * the eval fixture the demotion pays from 0.75 upwards (P@3 0.684 against a
	 * 0.670 baseline) and this is the top of that range: at 1.9 the fixture falls
	 * to 0.663, because a branded row that really is the plain food — "OLIVE OIL,
	 * MILD", "BREAD" — starts losing to generic rows that merely contain the
	 * words, and that is a worse answer than the one this weight exists to fix.
	 */
	unnamedBrand: 1.75
} as const;

/**
 * `n_sources` at which corroboration saturates. Above the largest whole-food
 * agreement in the catalog (247, for "Milk, whole") so that number still
 * separates it from a two-source row, and low enough that a 1,038-source row
 * gains nothing further over it.
 */
const CORROBORATION_SCALE = 250;

/** The core catalog's quality floor; rows below it normalize to zero rather than to a negative. */
const QUALITY_FLOOR = 87;

/** The span from that floor to a perfect 100, which the quality term divides by. */
const QUALITY_SPAN = 13;

/** At or above this, a generic row is a USDA reference food rather than a survey composite. */
const REFERENCE_QUALITY = 91;

/**
 * How many distinct-named rows reach the second pass. Every match is scored;
 * only the sort is bounded, which turns a full sort of tens of thousands of
 * rows into a bounded heap. It is an order of magnitude deeper than the largest
 * page a caller may ask for, so the byproduct and processed-form demotions have
 * room to move a row down without pushing it off the page.
 */
const SHORTLIST = 500;

/**
 * How deep into the score-ordered match set the duplicate-name collapse looks.
 *
 * The collapse used to run after the shortlist was cut, which made it a bug
 * rather than a tidy-up: hundreds of branded rows all named "PASTA" filled the
 * 500 and then became one row, so the query answered with a single food. On the
 * live catalog "pasta" returned 1 and "peanut butter" 2.
 *
 * Measured rather than guessed. Over 26 broad one-word queries at the largest
 * page a caller may ask for, the deepest a query had to look to find 50
 * distinct names was between 800 and 1,000 rows — "peanut butter", whose top
 * name is carried by 724 rows. This is twice that, and every one of the 26 fills
 * its page well inside it. It is not larger still because the cost is linear in
 * it: 500 to 1,000 costs 3% of the query, 1,000 to 5,000 costs a further 13%.
 */
const DEDUP_DEPTH = 2000;

/**
 * Words naming a preserved or substitute form. Matched anywhere in the name.
 * Kept short on purpose: this is a demotion, not a filter, and every word added
 * here is a food someone can still find by naming it.
 */
const PROCESSED_FORM_WORDS =
	'dried dehydrated powder frozen canned concentrate imitation meatless'.split(' ');

/** One trailing "s" dropped from a word longer than three characters — `singular` in `query.ts`, in SQL. */
function singularSql(column: string): string {
	return `case when length(${column}) > 3 and substr(${column}, -1) = 's'
				then substr(${column}, 1, length(${column}) - 1) else ${column} end`;
}

/**
 * The demotion, over both lists.
 *
 * A form word is matched anywhere in the name, because "powder" and "powdered"
 * are the same claim about the food. A part is matched as a whole name segment
 * against `parts`, for the reason `byproducts.ts` gives.
 */
function processedFormSql(column: string, parts: string): string {
	const forms = PROCESSED_FORM_WORDS.map((word) => `instr(lower(${column}), '${word}') > 0`);
	return `case when ${forms.join(' or ')} or ${byproductSql(parts)} then 1.0 else 0.0 end`;
}

/**
 * The three name terms, which are worth nothing unless the name leads with the
 * query. `head_name` is the name up to its first comma.
 *
 * They are gated together because each of them implies that lead: an exact name
 * is one, a head equal to the query is one, and a head that starts with the
 * query is one. The gate is what keeps `substr`, `instr` and the singular
 * rewrite off the tens of thousands of rows that merely contain the word.
 */
function nameTermsSql(): string {
	const w = RANK_WEIGHTS;
	const head = `case when instr(name, ',') > 0
					then lower(trim(substr(name, 1, instr(name, ',') - 1)))
					else lower(trim(name)) end`;
	return `case when name_leads = 0 then 0.0 else (
				with parts(full_name, head_name) as (values (lower(trim(name)), ${head}))
				select ${w.exactName} * (case when ${singularSql('full_name')} = :singular
						then 1.0 else 0.0 end)
					+ ${w.headName} * (case when ${singularSql('head_name')} = :singular
						then 1.0 else 0.0 end)
					+ ${w.headPrefix} * (case when head_name like :text || '%' then 1.0 else 0.0 end)
				from parts
			) end`;
}

/**
 * The ranked search, as one statement.
 *
 * `:match` is the FTS expression, `:text` the same tokens as plain text,
 * `:singular` that text with a trailing "s" dropped, `:prefix` the singular
 * followed by `%`, and `:limit` the page size.
 *
 * There is no `bm25()` here, and that is a measured choice rather than an
 * oversight. Blending BM25 in — name weighted ten to brand's two, divided by
 * the best score in the match set because BM25's scale moves with the query —
 * changed none of the eight measured queries except in which of several
 * identically named rows won a tie, and cost 16 ms per query. What BM25 would
 * have contributed, that a hit in the name beats a hit in the brand, the name
 * terms already say directly.
 *
 * Three passes, and the order of the last two is the whole of issue #106. The
 * first scores every matched row on terms that cost a comparison each. The
 * second collapses rows sharing a name, over the best `DEDUP_DEPTH` of them:
 * without it "milk" answers with five dairies' rows all named "MILK" and a
 * person sees one food five times. The third splits each surviving name into
 * its comma-separated parts and applies the processed-form and byproduct
 * penalty, over `SHORTLIST` rows rather than all of them.
 *
 * The collapse has to come before the cut, not after it. Cutting first is what
 * made "pasta" answer with one row: the hundreds of branded rows all named
 * "PASTA" filled the shortlist and then became one. Nothing is lost by
 * collapsing first, because the penalty the third pass applies is a function of
 * the name, so it is the same for every row the collapse is choosing between.
 */
export function searchSql(columns: string): string {
	const w = RANK_WEIGHTS;
	return `
with matched as (
	select rowid as food_id from food_fts where food_fts match :match
),
named as (
	select
		m.food_id as food_id,
		f.name as name,
		f.quality as row_quality,
		-- LIKE and lower() fold ASCII only, so a name whose leading word carries
		-- an accent would lose the name terms below. Three of the catalog's
		-- 426,456 names hold any non-ASCII character and none of them is a
		-- letter, so the cost of that today is nothing and the saved lower()
		-- call is real.
		(f.name like :prefix) as name_leads,
		${w.brevity} * min(1.0, (length(:text) * 1.0) / max(length(f.name), 1))
			+ ${w.generic} * (case when f.kind = 'generic' then 1.0 else 0.0 end)
			+ ${w.reference} * (case when f.kind = 'generic' and f.quality >= ${REFERENCE_QUALITY}
				then 1.0 else 0.0 end)
			+ ${w.corroboration} * min(1.0,
				ln(1.0 + f.n_sources) / ln(1.0 + ${CORROBORATION_SCALE}.0))
			+ ${w.quality} * max(0.0, (f.quality - ${QUALITY_FLOOR}) / ${QUALITY_SPAN}.0)
			- ${w.unnamedBrand} * ${unnamedBrandSql()}
			as row_score
	from matched m
	join food f on f.food_id = m.food_id
),
scored as (
	select food_id, name, row_quality, row_score + ${nameTermsSql()} as score
	from named
	order by score desc, row_quality desc
	limit ${DEDUP_DEPTH}
),
-- The collapse, before anything is cut to a page. The key is the name with one
-- trailing "s" dropped, so "Milk" and "Milks" are one food; the ordering inside
-- a name is what makes the survivor the best-scoring row of that name and, on a
-- tie, the highest-quality one.
deduplicated as (
	select
		food_id, name, row_quality, score,
		row_number() over (partition by ${singularSql('lower(trim(name))')}
			order by score desc, row_quality desc) as position
	from scored
),
shortlist as (
	select food_id, name, row_quality, score
	from deduplicated
	where position = 1
	order by score desc, row_quality desc
	limit ${SHORTLIST}
),
-- MATERIALIZED, and measured: the byproduct test names this CTE's column 33
-- times, and without the hint SQLite flattens the CTE and rebuilds the parts
-- string once per mention. That cost 21 ms a query on the live catalog, against
-- 5 ms with the hint.
segmented as materialized (
	select food_id, name, row_quality, score, ${namePartsSql('name')} as name_parts
	from shortlist
),
ranked as (
	select
		food_id,
		score - ${w.processedForm} * ${processedFormSql('name', 'name_parts')} as score,
		row_quality
	from segmented
)
select ${columns}
from ranked d
join food f on f.food_id = d.food_id
order by d.score desc, f.quality desc
limit :limit
`;
}

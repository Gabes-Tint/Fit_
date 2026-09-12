/**
 * A probe title as a slug (#388).
 *
 * The workflow probes are named by hand, so their titles carry whatever a
 * person typed — mixed case, punctuation, runs of spaces. A slug is what can
 * go in a URL, so it is derived from the title rather than typed a second
 * time: one name to keep in sync instead of two.
 *
 * Framework-free and side-effect-free on purpose — it is a pure string
 * function, so it is the same answer on the server, in the browser, and in a
 * spec.
 */

/**
 * The slug of a title there was no slug in: `'???'`, `''`, punctuation alone.
 * Exported and named because a slug is never the empty string, and a caller
 * that wants to tell a derived slug from that floor needs something to
 * compare against.
 */
export const PROBE_SLUG_FALLBACK = 'probe';

/**
 * A URL-safe slug for `value`.
 *
 * Read as the runs of letters and digits the title contains, joined by single
 * dashes. Stated that way rather than as "replace the punctuation, then trim
 * the dashes it left at the ends", because the runs are what the slug is made
 * of: punctuation between words collapses to one dash however much of it
 * there was, and punctuation at either end is simply not part of any run, so
 * there is nothing to trim afterwards.
 *
 * A title with no such run — {@link PROBE_SLUG_FALLBACK}'s case — has no slug
 * to derive at all.
 */
export function slugifyProbe(value: string): string {
	const words = value.toLowerCase().match(/[a-z0-9]+/g);
	return words === null ? PROBE_SLUG_FALLBACK : words.join('-');
}

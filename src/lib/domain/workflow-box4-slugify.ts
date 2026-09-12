/**
 * A probe title, turned into something safe to put in a URL (#388).
 *
 * Probe titles are written for people — `'  Hello,  Fit_ World! '` — and are
 * read back as path segments, so every run of punctuation, whitespace and
 * underscore collapses to one dash and the ends are trimmed. Nothing here
 * touches the DOM, the store or the network: it is a pure string function, so
 * a caller can slug a title on the server, in a test, or in the browser and
 * get the same answer.
 */

/**
 * What a title with no letters or digits in it slugs to.
 *
 * Exported so a caller can recognise the fallback — "this probe has no name of
 * its own" — without repeating the literal and drifting from it.
 */
export const PROBE_FALLBACK_SLUG = 'probe';

/**
 * The URL-safe slug for a probe title.
 *
 * Returns `PROBE_FALLBACK_SLUG` rather than `''` for a title that is empty or
 * all punctuation, because an empty segment would silently shorten the path it
 * is spliced into and point the probe somewhere else.
 */
export function slugifyProbe(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		// One dash each end at most: the line above has already collapsed every
		// run, so there is never a second dash left to trim.
		.replace(/^-|-$/g, '');
	return slug || PROBE_FALLBACK_SLUG;
}

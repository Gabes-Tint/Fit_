/**
 * Rung 4 → 5: adds the left-handed preference.
 *
 * Version 4 documents have no opinion on which side the floating menu button
 * and the side menu sit on — they always sat bottom-right and slid in from the
 * left. Version 5 makes that a preference, `leftHanded`, defaulting to `false`
 * so every document written before this rung keeps behaving exactly as it did.
 */

type Document = Record<string, unknown>;

/** The shape this rung produces. */
const VERSION_5 = 5;

export function migrate_4_to_5(document: Document): Document {
	// A rung must never run twice on its own output: read the same key the ladder
	// keys off of, so the guarantee does not rest on the caller.
	if (document['schemaVersion'] === VERSION_5) return document;
	return {
		...document,
		schemaVersion: VERSION_5,
		// A document may already carry `leftHanded` — `replace()` can hand the
		// ladder one taken from another device before this rung ever ran on it —
		// and that value is honoured rather than overwritten. Only its absence
		// gets the off default.
		leftHanded: typeof document['leftHanded'] === 'boolean' ? document['leftHanded'] : false
	};
}

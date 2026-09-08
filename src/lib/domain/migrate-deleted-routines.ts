/**
 * Rung 2 → 3: a routine can be deleted without being removed.
 *
 * Version 2 had one way for a routine to leave: the row went out of `routines`,
 * and every planned day pointing at it went with it. That rewrote history —
 * past planned days are the denominator of the adherence percentage, so a
 * routine somebody stopped doing took its missed sessions out of the count and
 * the score rose on its own. Version 3 flags instead, and strips the plan from
 * the day of the deletion forward only.
 *
 * So every routine already in the document gains `deletedAt: null`: it is in the
 * rotation, because in version 2 there was no other way for it to still be
 * there. Nothing else moves. A row that is not an object is left exactly as it
 * came, and so is a `routines` that is not a list — this rung has no more right
 * to repair a malformed document than the shape check that will refuse it a
 * moment later.
 */

type Document = Record<string, unknown>;

export function migrate_2_to_3(document: Document): Document {
	const routines = document['routines'];
	return {
		...document,
		schemaVersion: 3,
		routines: Array.isArray(routines)
			? (routines as unknown[]).map((routine) =>
					routine !== null && typeof routine === 'object'
						? { ...(routine as Document), deletedAt: null }
						: routine
				)
			: routines
	};
}

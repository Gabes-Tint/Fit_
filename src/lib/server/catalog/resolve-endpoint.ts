import { json } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { withinLimits } from '$lib/domain/resolve-limits';
import {
	apiError,
	declaredMediaType,
	JSON_CONTENT_TYPE,
	MAX_BODY_BYTES,
	readJsonText,
	withinDeclaredLength
} from '../api';
import { ready } from './endpoints';
import { resolveFood } from './resolve';

/**
 * `POST /api/foods/resolve`: the catalog rows for the food names one typed
 * sentence held.
 *
 * The client still splits "two eggs, 150g rice" into chunks and reads the
 * quantities off them -- that is arithmetic on the words and needs no catalog.
 * Naming the food is the part that needs 2.5 million rows, so it happens here,
 * for the whole sentence in one round trip rather than one request per chunk.
 */

/** The part of SvelteKit's `RequestEvent` this handler uses, kept narrow as its siblings are. */
export type ResolveEvent = {
	request: Request;
	locals: App.Locals;
};

/** One code for every way the body is wrong: none of them says anything about stored state. */
type ParsedResolveBody = { ok: true; queries: string[] } | { ok: false };

const REFUSED = { ok: false } as const;

/**
 * Whether the field is a list of names this endpoint will search for: present,
 * every entry a string, and the list within the caps `resolve-limits.ts` sets
 * for both sides of the wire.
 */
function namesQueries(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	if (!value.every((query) => typeof query === 'string')) return false;
	return withinLimits(value);
}

/**
 * The names asked about, or the refusal.
 *
 * The caps come from `resolve-limits.ts`, which both sides of the wire read, so
 * the client cannot build a request this refuses; they are still checked here,
 * because a client that ignores them is exactly what this has to turn away.
 * `MAX_BODY_BYTES` is `api.ts`'s ceiling for a handful of short strings, and
 * twelve names of eighty characters sits well inside it.
 */
async function readResolveBody(request: Request): Promise<ParsedResolveBody> {
	if (declaredMediaType(request) !== JSON_CONTENT_TYPE) return REFUSED;
	if (!withinDeclaredLength(request, MAX_BODY_BYTES)) return REFUSED;

	const raw = await readJsonText(request, MAX_BODY_BYTES);
	if (raw === null) return REFUSED;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Text that is not JSON at all is turned away beside JSON's own `null`,
		// which `namesQueries` already refuses through the field it never has.
		return REFUSED;
	}
	if (parsed === null) return REFUSED;
	// A string and a number answer `undefined` for the field, which
	// `namesQueries` already turns away, so there is no separate "is this an
	// object" test for a body no caller could get past it.
	const queries = (parsed as Record<string, unknown>)['queries'];
	if (!namesQueries(queries)) return REFUSED;
	return { ok: true, queries };
}

/**
 * Resolve every name one sentence held.
 *
 * The refusals run in the order the catalog's other handlers use: no session
 * first, then no catalog, then a body this endpoint cannot read. `items` is
 * one row per query, in the order they were asked, so the caller can line the
 * answers up with its own chunks without matching on the text.
 */
export async function resolveFoodNames(
	catalog: DatabaseSync | null,
	event: ResolveEvent
): Promise<Response> {
	const gate = ready(catalog, event.locals);
	if (!gate.ok) return gate.response;
	const body = await readResolveBody(event.request);
	if (!body.ok) return apiError('invalid-body');
	return json({
		items: body.queries.map((query) => ({ query, ...resolveFood(gate.catalog, query) }))
	});
}

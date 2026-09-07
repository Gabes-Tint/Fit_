import { MEALS, type Meal } from '$lib/domain/types';
import { declaredMediaType, JSON_CONTENT_TYPE, readJsonText, withinDeclaredLength } from '../api';

/**
 * The body `POST /api/meals/photo` accepts, and the one reason it is refused.
 *
 * A photo is not four short text fields, so `readTextBody` in `api.ts` and its
 * 4 KB ceiling do not fit; nor is it the household's whole document, so
 * `readStateBody` does not either. This one carries a still and a meal, and
 * everything it can be wrong about is the caller's own input.
 */

/**
 * A 720 px JPEG at quality 0.82 — what `src/lib/ui/camera.ts` produces — is
 * tens of kilobytes of base64, so 450 KB is an order of magnitude of headroom
 * for a device whose camera is larger than the one measured.
 *
 * It is under `adapter-node`'s `BODY_SIZE_LIMIT`, which defaults to 512 KB and
 * which nothing in this repository sets. A ceiling above that would be a
 * ceiling this handler never reaches: the server would answer 413 before the
 * request arrived here, and the caller would be told the wrong thing about a
 * body this code had never seen.
 */
export const MAX_PHOTO_BODY_BYTES = 450 * 1024;

/**
 * Only JPEG, and only base64. The capture path emits exactly this prefix, so
 * anything else is a caller that built the body by hand — and a data URL of
 * another type is a request to forward an arbitrary file to a paid API.
 */
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export type ParsedPhotoBody =
	| { ok: true; image: string; meal: Meal }
	/** One code for every way the body is wrong: none of them says anything about stored state. */
	| { ok: false; code: 'invalid-body' };

const REFUSED = { ok: false, code: 'invalid-body' } as const;

/**
 * `includes` on a tuple of strings is already false for every value that is not
 * one of them, so there is no `typeof` guard here: it would be a branch no input
 * could take differently.
 */
function isMeal(value: unknown): value is Meal {
	return MEALS.includes(value as Meal);
}

/**
 * The request as a still and a meal, or the refusal.
 *
 * The ceiling is checked twice: once against the declared `content-length`, so
 * an oversized body is refused before it is read, and once against the text
 * actually received, because the header is only what the sender claims.
 */
export async function readPhotoBody(request: Request): Promise<ParsedPhotoBody> {
	if (declaredMediaType(request) !== JSON_CONTENT_TYPE) return REFUSED;
	if (!withinDeclaredLength(request, MAX_PHOTO_BODY_BYTES)) return REFUSED;

	const raw = await readJsonText(request, MAX_PHOTO_BODY_BYTES);
	if (raw === null) return REFUSED;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Text that is not JSON at all is turned away beside JSON's own `null`.
		return REFUSED;
	}
	if (parsed === null) return REFUSED;
	const fields = parsed as Record<string, unknown>;
	const image = fields['image'];
	const meal = fields['meal'];
	// The type check is not narrowing for the compiler's sake: `test` coerces its
	// argument, so a one-element array of a valid data URL would match, and the
	// array — not a string — would then be forwarded to a paid API.
	if (typeof image !== 'string' || !JPEG_DATA_URL.test(image)) return REFUSED;
	if (!isMeal(meal)) return REFUSED;
	return { ok: true, image, meal };
}

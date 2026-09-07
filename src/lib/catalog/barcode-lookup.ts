import { resolve } from '$app/paths';
import {
	catalogFoodToFood,
	isCatalogFoodPayload,
	normalizeBarcode
} from '$lib/domain/catalog-food';
import type { Food } from '$lib/domain/types';

/**
 * What a scanned barcode turns out to be.
 *
 * Every code asks `/api/foods/barcode`, whose ambiguity, absence and refusal are
 * all distinct outcomes here: a barcode nobody has heard of and a catalog that
 * is out of reach need different words, and neither is a dead end. Until #146
 * two bundled packages answered before the request went out; that offline path
 * covered two barcodes out of 2.5 million rows and made "the scanner works
 * offline" a claim the app could not keep.
 */
export type BarcodeOutcome =
	/** Not a barcode. Nothing was sent. */
	| { kind: 'invalid' }
	/** One food, or — for the 30 barcodes the ETL reports on two rows — several to choose between. */
	| { kind: 'known'; code: string; foods: Food[]; ambiguous: boolean }
	/** The catalog was read and does not carry this code. */
	| { kind: 'unknown'; code: string }
	/** The catalog needs a session this device does not have. */
	| { kind: 'signed-out'; code: string }
	/** No connection, no catalog on the server, or an answer that could not be read. */
	| { kind: 'unreachable'; code: string };

async function fromCatalog(code: string, doFetch: typeof fetch): Promise<BarcodeOutcome> {
	let response: Response;
	try {
		response = await doFetch(`${resolve('/api/foods/barcode')}?code=${code}`);
	} catch {
		// A dropped connection is not an answer about this barcode.
		return { kind: 'unreachable', code };
	}
	if (response.status === 404) return { kind: 'unknown', code };
	if (response.status === 400) return { kind: 'invalid' };
	if (!response.ok) {
		return response.status === 401 ? { kind: 'signed-out', code } : { kind: 'unreachable', code };
	}

	// A body that is not JSON reads as `null`, the same as the JSON literal
	// `null`: neither is an answer about this barcode, and neither carries rows.
	const body = (await response.json().catch(() => null)) as { foods?: unknown } | null;
	const rows = body === null ? null : body.foods;
	if (!Array.isArray(rows)) return { kind: 'unreachable', code };
	// An empty list is the endpoint's 404 by another route; it is not a match.
	if (rows.length === 0) return { kind: 'unknown', code };
	// One unreadable row makes the whole answer unreadable: silently dropping it
	// would offer a shorter list of foods than the barcode actually names.
	if (!rows.every(isCatalogFoodPayload)) return { kind: 'unreachable', code };

	return { kind: 'known', code, foods: rows.map(catalogFoodToFood), ambiguous: rows.length > 1 };
}

/** The food or foods a scanned or typed barcode names. */
export async function lookupBarcode(
	raw: string,
	doFetch: typeof fetch = fetch
): Promise<BarcodeOutcome> {
	const code = normalizeBarcode(raw);
	if (code === null) return { kind: 'invalid' };
	return fromCatalog(code, doFetch);
}

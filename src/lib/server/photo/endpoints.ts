import { json } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import type { Meal } from '$lib/domain/types';
import { apiError, retryAfter } from '../api';
import { resolveFood, type ResolvedFood } from '../catalog/resolve';
import { readPhotoBody } from './request';
import { reservePhotoCall } from './quota';
import { readPlate, visionApiKey, visionModel, type PlateItem, type PlateReading } from './vision';

/**
 * `POST /api/meals/photo`: what the vision model saw, resolved against the food
 * catalog.
 *
 * The model names foods and estimates weights; every calorie comes from
 * `resolveFood`. That split is the whole design — a model that hallucinates a
 * number cannot put it in anybody's day, only a wrong food the person can see
 * and correct.
 */

/** The part of SvelteKit's `RequestEvent` this handler uses, kept narrow as its siblings are. */
export type PhotoEvent = {
	request: Request;
	locals: App.Locals;
};

/**
 * One food the photo held. `food` is what the catalog ranked first for the
 * model's search terms and `alternatives` the two behind it, so a wrong first
 * guess is one tap from being right. `label` and `grams` are the model's own
 * and are all the person sees when the catalog matched nothing.
 */
export type PhotoItem = ResolvedFood & {
	label: string;
	grams: number;
};

export type PhotoDependencies = {
	/** Whether this deployment has a key at all. Asked before anything is reserved. */
	configured: () => boolean;
	/** Injected so every request shape and every upstream failure is testable without a network. */
	read: (image: string, meal: Meal) => Promise<PlateReading>;
	now: () => Date;
	/** One line per call, so the spend is auditable in `journalctl`. */
	log: (line: string) => void;
};

export const photoDependencies: PhotoDependencies = {
	configured: () => visionApiKey() !== null,
	read: (image, meal) => readPlate(image, meal),
	now: () => new Date(),
	log: (line) => console.info(line)
};

/** The catalog's answer for one thing the model saw. */
function resolveItem(catalog: DatabaseSync, item: PlateItem): PhotoItem {
	return { label: item.label, grams: item.grams, ...resolveFood(catalog, item.searchQuery) };
}

/** What the audit line says about a call that did not come back. */
function upstreamOf(reading: PlateReading & { ok: false }): string {
	if (reading.reason === 'not-configured') return 'not-configured';
	// `null` is a timeout or a dropped connection: no status ever arrived.
	return reading.status === null ? 'timeout' : String(reading.status);
}

/**
 * Read a plate.
 *
 * The order of the refusals is the order of what they cost: a session first,
 * then the body, then the catalog without which a reading would resolve to
 * nothing, then the key without which nothing can be read at all — and only
 * then is the day's allowance spent, before the request goes out rather than
 * after it comes back. Nothing about the upstream reaches the caller: every way
 * the model can fail is one 503 with one code, because there is nothing the
 * client could do differently about any of them.
 */
export async function readMealPhoto(
	db: DatabaseSync,
	catalog: DatabaseSync | null,
	event: PhotoEvent,
	dependencies: PhotoDependencies = photoDependencies
): Promise<Response> {
	const auth = event.locals.auth;
	if (auth === null) return apiError('unauthenticated');

	const parsed = await readPhotoBody(event.request);
	if (!parsed.ok) return apiError(parsed.code);

	// Without the catalog every item would come back with no food and no
	// nutrition, so the money is not worth spending: this is the same answer
	// `/api/foods` gives a deployment that has no catalog file.
	if (catalog === null) return apiError('catalog-unavailable');

	// Asked before the allowance is touched: with no key nothing can be sent, so
	// nothing should be reserved or logged as spend.
	if (!dependencies.configured()) return apiError('photo-unavailable');

	const accountId = auth.account.id;
	const now = dependencies.now();
	// Reserved rather than checked, and reserved before the call rather than
	// counted after it: `reservePhotoCall` says why.
	const allowance = reservePhotoCall(db, accountId, now);
	if (!allowance.allowed)
		return apiError('too-many-attempts', {}, retryAfter(allowance.retryAfterMs));

	const reading = await dependencies.read(parsed.image, parsed.meal);
	if (!reading.ok) {
		dependencies.log(
			`photo: account=${accountId} model=${visionModel()} upstream=${upstreamOf(reading)}`
		);
		return apiError('photo-unavailable');
	}

	const { promptTokens, completionTokens, totalTokens } = reading.usage;
	dependencies.log(
		`photo: account=${accountId} model=${reading.model} items=${reading.items.length} ` +
			`prompt=${promptTokens} completion=${completionTokens} total=${totalTokens}`
	);
	return json({ items: reading.items.map((item) => resolveItem(catalog, item)) });
}

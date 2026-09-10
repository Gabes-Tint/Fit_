import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import { openDatabase } from '../db';
import type { Auth } from '../users/types';
import { photoDependencies, readMealPhoto, type PhotoEvent, type PhotoItem } from './endpoints';
import { ACCOUNT_DAILY_LIMIT, GLOBAL_DAILY_LIMIT, reservePhotoCall } from './quota';
import type { PlateReading } from './vision';

const SIGNED_IN = {
	account: { id: 'a1', username: 'jordan', displayName: 'Jordan', createdAt: '2026-01-01' },
	session: { id: 's1', accountId: 'a1', expiresAt: '2026-02-01' },
	households: [{ householdId: 'h1', name: 'Flat 3', role: 'owner' }]
} satisfies Auth;

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const NOON = new Date('2026-09-04T12:00:00.000Z');

function eventFor(body: unknown, auth: Auth | null = SIGNED_IN): PhotoEvent {
	return {
		request: new Request('https://fit.example/api/meals/photo', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		locals: { auth }
	};
}

/**
 * A fresh event each time: a `Request` body may only be read once, so a shared
 * one would make the second test that used it fail on a stream nothing sent.
 */
function plate(): PhotoEvent {
	return eventFor({ image: IMAGE, meal: 'lunch' });
}

/** A reading that found the two foods the fixture catalog knows about. */
function found(...queries: string[]): PlateReading {
	return {
		ok: true,
		model: 'gpt-5-nano',
		items: queries.map((searchQuery, index) => ({
			label: `label ${index}`,
			searchQuery,
			grams: 100 + index
		})),
		usage: { promptTokens: 508, completionTokens: 78, totalTokens: 586 }
	};
}

let db: DatabaseSync;
let catalog: DatabaseSync;
let log: ReturnType<typeof vi.fn<(line: string) => void>>;

function deps(reading: PlateReading) {
	return {
		configured: () => true,
		read: vi.fn(() => Promise.resolve(reading)),
		now: () => NOON,
		log
	};
}

/** Dependencies whose reading is held open until the returned `release` is called. */
function holding(reading: PlateReading) {
	let release = () => undefined as void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const read = vi.fn(async () => {
		await held;
		return reading;
	});
	return { dependencies: { configured: () => true, read, now: () => NOON, log }, read, release };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

async function itemsOf(response: Response): Promise<PhotoItem[]> {
	return (await bodyOf(response))['items'] as PhotoItem[];
}

beforeEach(() => {
	db = openDatabase(':memory:');
	catalog = createFixtureCatalog();
	log = vi.fn<(line: string) => void>();
});

afterEach(() => {
	db.close();
	catalog.close();
	vi.restoreAllMocks();
});

describe('who may ask', () => {
	it('refuses a request with no session, as every other endpoint does', async () => {
		const dependencies = deps(found('milk'));
		const response = await readMealPhoto(
			db,
			catalog,
			eventFor({ image: IMAGE, meal: 'lunch' }, null),
			dependencies
		);
		expect(response.status).toBe(401);
		expect(await bodyOf(response)).toEqual({ error: { code: 'unauthenticated' } });
		expect(dependencies.read).not.toHaveBeenCalled();
	});

	it('decides the session before it reads the body, so a stranger cannot spend a parse', async () => {
		const response = await readMealPhoto(db, catalog, eventFor('nonsense', null), deps(found()));
		expect(await bodyOf(response)).toEqual({ error: { code: 'unauthenticated' } });
	});
});

describe('what it accepts', () => {
	it('refuses a body that is not a JPEG data URL', async () => {
		const png = eventFor({ image: 'data:image/png;base64,iVBORw0K', meal: 'lunch' });
		const dependencies = deps(found('milk'));
		const response = await readMealPhoto(db, catalog, png, dependencies);
		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({ error: { code: 'invalid-body' } });
		expect(dependencies.read).not.toHaveBeenCalled();
	});

	it('refuses a meal outside the four the app offers', async () => {
		const response = await readMealPhoto(
			db,
			catalog,
			eventFor({ image: IMAGE, meal: 'brunch' }),
			deps(found('milk'))
		);
		expect(response.status).toBe(400);
	});

	it('refuses a body past the ceiling', async () => {
		const huge = eventFor({ image: `${IMAGE}${'A'.repeat(450 * 1024)}`, meal: 'lunch' });
		const response = await readMealPhoto(db, catalog, huge, deps(found('milk')));
		expect(response.status).toBe(400);
	});

	it('sends the still and the meal on to the model unchanged', async () => {
		const dependencies = deps(found('milk'));
		await readMealPhoto(db, catalog, eventFor({ image: IMAGE, meal: 'dinner' }), dependencies);
		expect(dependencies.read).toHaveBeenCalledWith(IMAGE, 'dinner');
	});
});

describe('when the server cannot read a photo', () => {
	it('says so, and spends nothing, when no key is configured', async () => {
		const dependencies = { ...deps(found('milk')), configured: () => false };
		const response = await readMealPhoto(db, catalog, plate(), dependencies);
		expect(response.status).toBe(503);
		expect(await bodyOf(response)).toEqual({ error: { code: 'photo-unavailable' } });
		expect(db.prepare('select count(*) as n from photo_quota').get()?.['n']).toBe(0);
		expect(dependencies.read).not.toHaveBeenCalled();
	});

	it('logs a key that went missing between the check and the call', async () => {
		await readMealPhoto(db, catalog, plate(), deps({ ok: false, reason: 'not-configured' }));
		expect(log.mock.calls[0]?.[0]).toContain('upstream=not-configured');
	});

	it('says so when the model refused, and keeps the reservation', async () => {
		const dependencies = deps({ ok: false, reason: 'unavailable', status: 429 });
		const response = await readMealPhoto(db, catalog, plate(), dependencies);
		expect(response.status).toBe(503);
		expect(await bodyOf(response)).toEqual({ error: { code: 'photo-unavailable' } });
		expect(db.prepare('select count(*) as n from photo_quota').get()?.['n']).toBe(2);
	});

	it('never tells the caller what the upstream said', async () => {
		const dependencies = deps({ ok: false, reason: 'unavailable', status: 401 });
		const response = await readMealPhoto(db, catalog, plate(), dependencies);
		expect(JSON.stringify(await bodyOf(response))).not.toContain('401');
	});

	it('logs the upstream status server-side, so a broken key is findable', async () => {
		await readMealPhoto(
			db,
			catalog,
			plate(),
			deps({ ok: false, reason: 'unavailable', status: 401 })
		);
		expect(log.mock.calls[0]?.[0]).toContain('upstream=401');
	});

	it('logs a timeout as one, rather than as a status it never got', async () => {
		await readMealPhoto(
			db,
			catalog,
			plate(),
			deps({ ok: false, reason: 'unavailable', status: null })
		);
		expect(log.mock.calls[0]?.[0]).toContain('upstream=timeout');
	});

	it('refuses before spending anything when the catalog is not installed', async () => {
		const dependencies = deps(found('milk'));
		const response = await readMealPhoto(db, null, plate(), dependencies);
		expect(response.status).toBe(503);
		expect(await bodyOf(response)).toEqual({ error: { code: 'catalog-unavailable' } });
		expect(dependencies.read).not.toHaveBeenCalled();
	});
});

describe('the spend guard', () => {
	it('refuses once the account has spent its day', async () => {
		for (let index = 0; index < ACCOUNT_DAILY_LIMIT; index += 1) reservePhotoCall(db, 'a1', NOON);
		const dependencies = deps(found('milk'));
		const response = await readMealPhoto(db, catalog, plate(), dependencies);
		expect(response.status).toBe(429);
		expect(await bodyOf(response)).toEqual({ error: { code: 'too-many-attempts' } });
		expect(dependencies.read).not.toHaveBeenCalled();
	});

	it('says how long the caller has to wait, in whole seconds to the next UTC midnight', async () => {
		for (let index = 0; index < ACCOUNT_DAILY_LIMIT; index += 1) reservePhotoCall(db, 'a1', NOON);
		const response = await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		expect(response.headers.get('retry-after')).toBe(String(12 * 60 * 60));
	});

	it('refuses once the deployment has spent its day, whoever is asking', async () => {
		for (let index = 0; index < GLOBAL_DAILY_LIMIT; index += 1)
			reservePhotoCall(db, `a${index}`, NOON);
		const response = await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		expect(response.status).toBe(429);
	});

	it('counts one call per request that goes out', async () => {
		await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		const rows = db.prepare('select scope, holder, calls from photo_quota order by scope').all();
		expect(rows).toEqual([
			{ scope: 'account', holder: 'a1', calls: 1 },
			{ scope: 'global', holder: '', calls: 1 }
		]);
	});

	it('leaves no increment behind when it refuses', async () => {
		for (let index = 0; index < ACCOUNT_DAILY_LIMIT; index += 1) reservePhotoCall(db, 'a1', NOON);
		await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		const rows = db.prepare('select scope, calls from photo_quota order by scope').all();
		expect(rows).toEqual([
			{ scope: 'account', calls: ACCOUNT_DAILY_LIMIT },
			{ scope: 'global', calls: ACCOUNT_DAILY_LIMIT }
		]);
	});

	it('reserves the allowance before the call rather than counting it after', async () => {
		// Regression: the ceiling used to be read before a twenty-second await and
		// written after it, so every request in flight read the same count and
		// every one of them was allowed. Forty-five at once must still be forty.
		const { dependencies, read, release } = holding(found('milk'));
		const inFlight = Array.from({ length: ACCOUNT_DAILY_LIMIT + 5 }, () =>
			readMealPhoto(db, catalog, plate(), dependencies)
		);
		// One turn of the timer queue is enough for every handler to reach its
		// held reading, because the reservation before it is synchronous.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(read).toHaveBeenCalledTimes(ACCOUNT_DAILY_LIMIT);

		release();
		const answers = await Promise.all(inFlight);
		expect(answers.filter((answer) => answer.status === 200)).toHaveLength(ACCOUNT_DAILY_LIMIT);
		expect(answers.filter((answer) => answer.status === 429)).toHaveLength(5);
		expect(read).toHaveBeenCalledTimes(ACCOUNT_DAILY_LIMIT);
	});
});

describe('the plate it answers with', () => {
	it('resolves each thing the model saw against the catalog', async () => {
		const response = await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		expect(response.status).toBe(200);
		const items = await itemsOf(response);
		expect(items).toHaveLength(1);
		// The catalog's own first-ranked row for "milk", which #337 made the
		// generic food rather than the dairy's branded row of the same name.
		expect(items[0]?.food?.name).toBe('Milk, whole');
	});

	it('keeps the model’s own label and portion beside the catalog food', async () => {
		const items = await itemsOf(await readMealPhoto(db, catalog, plate(), deps(found('milk'))));
		expect(items[0]).toMatchObject({ label: 'label 0', grams: 100 });
	});

	it('offers the two next-best matches, and never more', async () => {
		const items = await itemsOf(await readMealPhoto(db, catalog, plate(), deps(found('milk'))));
		expect(items[0]?.alternatives).toHaveLength(2);
		expect(items[0]?.alternatives.map((food) => food.name)).toEqual(['Milk, dried', 'MILK']);
	});

	it('says plainly when the catalog matched nothing, rather than dropping the food', async () => {
		const items = await itemsOf(
			await readMealPhoto(db, catalog, plate(), deps(found('quixotic tessellated marzipan')))
		);
		expect(items).toEqual([{ label: 'label 0', grams: 100, food: null, alternatives: [] }]);
	});

	it('answers one item per thing the model saw, in the order it saw them', async () => {
		const items = await itemsOf(
			await readMealPhoto(db, catalog, plate(), deps(found('milk', 'banana')))
		);
		expect(items.map((item) => item.food?.name)).toEqual(['Milk, whole', 'Bananas, raw']);
	});

	it('answers an empty plate as an empty list, not as a failure', async () => {
		const response = await readMealPhoto(db, catalog, plate(), deps(found()));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({ items: [] });
	});

	it('never lets a nutrient come from the model', async () => {
		const items = await itemsOf(await readMealPhoto(db, catalog, plate(), deps(found('milk'))));
		// Every fixture row carries the same per-100 g energy; the model was told none of it.
		expect(items[0]?.food?.per100g.kcal).toBe(100);
	});
});

describe('the audit line', () => {
	it('names the account, the model and what the call cost', async () => {
		await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		const line = String(log.mock.calls[0]?.[0]);
		expect(line).toContain('account=a1');
		expect(line).toContain('model=gpt-5-nano');
		expect(line).toContain('prompt=508');
		expect(line).toContain('completion=78');
		expect(line).toContain('total=586');
	});

	it('says how many foods the call produced', async () => {
		await readMealPhoto(db, catalog, plate(), deps(found('milk', 'banana')));
		expect(String(log.mock.calls[0]?.[0])).toContain('items=2');
	});

	it('writes exactly one line per call', async () => {
		await readMealPhoto(db, catalog, plate(), deps(found('milk')));
		expect(log).toHaveBeenCalledTimes(1);
	});
});

describe('the production wiring', () => {
	it('logs through the console, which is what journalctl collects', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		photoDependencies.log('photo: account=a1');
		expect(info).toHaveBeenCalledWith('photo: account=a1');
	});

	it('reads the clock rather than a fixed moment', () => {
		expect(photoDependencies.now()).toBeInstanceOf(Date);
	});

	it('asks the vision model, and says so when no key is configured', async () => {
		vi.stubEnv('OPENAI_API_KEY', '');
		await expect(photoDependencies.read(IMAGE, 'lunch')).resolves.toEqual({
			ok: false,
			reason: 'not-configured'
		});
		vi.unstubAllEnvs();
	});

	it('reads whether a key is configured from the environment', () => {
		vi.stubEnv('OPENAI_API_KEY', '');
		expect(photoDependencies.configured()).toBe(false);
		vi.stubEnv('OPENAI_API_KEY', 'sk-configured');
		expect(photoDependencies.configured()).toBe(true);
		vi.unstubAllEnvs();
	});
});

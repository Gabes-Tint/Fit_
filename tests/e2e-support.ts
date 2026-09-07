import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Reset one worker's registration allowance: the suite makes more than the ten attempts an
 * hour the policy allows from one address, and every worker registers from 127.0.0.1.
 *
 * `databasePath` is the calling worker's own database, so this touches nothing another
 * worker can see. Clears only the `registration` scope — per-username and per-address scopes
 * are left intact so intentional sign-in failures still count against the throttle.
 */
export function clearRegistrationThrottle(databasePath: string): void {
	// `data/runtime` is gitignored and created lazily by the server; if absent, nothing has been counted.
	if (!existsSync(databasePath)) return;
	const database = new DatabaseSync(databasePath);
	try {
		// The worker and its preview server share this file; avoids SQLITE_BUSY flakes.
		database.exec('pragma busy_timeout = 5000');
		// Schema is created lazily by the server; no table means nothing was counted.
		const created = database
			.prepare("select 1 from sqlite_master where type = 'table' and name = ?")
			.get('sign_in_throttle');
		if (created !== undefined)
			database.exec("delete from sign_in_throttle where scope = 'registration'");
	} finally {
		database.close();
	}
}

/**
 * Spelled out rather than imported from `state/session.svelte.ts` (compiled Svelte, can't run in Node).
 * A spec beside that module asserts the same string, so a rename is caught.
 */
const SESSION_STORAGE_KEY = 'fit.session.v1';

const PASSWORD = 'salt-and-pepper-mill';

/**
 * UUID is unique per run (the DB file persists) and its chars fit the server's allowed set.
 * Also keeps per-username throttle from bleeding across tests.
 */
export function freshUsername(): string {
	return `e2e-${randomUUID().slice(0, 13)}`;
}

/**
 * The `localStorage` record the shell reads, written via `addInitScript` because the
 * cookie `page.request` just collected is HttpOnly.
 *
 * `addInitScript` runs on every page load; seeding unconditionally would resurrect sessions
 * after sign-out. The `sessionStorage` flag ensures the seed happens once per tab, and each
 * caller passes its own flag so a second sign-in on the same context is not blocked by the
 * first one's.
 */
async function seedSessionRecord(page: Page, record: string, flag: string): Promise<void> {
	await page.addInitScript(
		([key, value, once]) => {
			if (globalThis.sessionStorage.getItem(once ?? '') !== null) return;
			globalThis.sessionStorage.setItem(once ?? '', '1');
			globalThis.localStorage.setItem(key ?? '', value ?? '');
		},
		[SESSION_STORAGE_KEY, record, flag]
	);
}

/**
 * Registers via API (not the form) so failures below are attributable.
 * `page.request` shares the cookie jar; `origin` is required by `hooks.server.ts`.
 */
export async function signInThroughApi(
	page: Page,
	baseURL: string,
	username = freshUsername()
): Promise<string> {
	const response = await page.request.post('/api/accounts', {
		headers: { origin: new URL(baseURL).origin },
		data: { username, displayName: 'Robin', password: PASSWORD, householdName: 'Kitchen' }
	});
	expect(response.status()).toBe(201);
	await seedSessionRecord(page, JSON.stringify(await response.json()), 'fit.e2e.seeded');
	return username;
}

/**
 * Sign an already-registered account in on this context — the other half of the pair, and
 * the only way to put the same account on a second device.
 */
export async function returnThroughApi(
	page: Page,
	baseURL: string,
	username: string,
	flag = 'fit.e2e.returned'
): Promise<void> {
	const response = await page.request.post('/api/sessions', {
		headers: { origin: new URL(baseURL).origin },
		data: { username, password: PASSWORD }
	});
	expect(response.status()).toBe(200);
	await seedSessionRecord(page, JSON.stringify(await response.json()), flag);
}

/** End the session from the drawer, which is the only place that offers it. */
export async function signOutThroughDrawer(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
}

/**
 * One catalog row in the shape `/api/foods/resolve` sends it.
 *
 * The real food catalog is a 365 MB file built by a separate ETL step and is
 * not present in this environment, so the endpoint answers 503
 * "catalog-unavailable" here. These rows and `stubFoodResolve` are the same
 * interception `barcode-scan.e2e.ts` already uses for `/api/foods/barcode`.
 * What is real: the client's handling of its own endpoint contract. What is
 * not proven: that the live catalog ranks these names to these rows.
 */
export type ResolvedRow = {
	id: number;
	name: string;
	brand: string | null;
	kind: string;
	category: string | null;
	barcode: string | null;
	license: string;
	serving: { label: string; grams: number };
	per100g: Record<string, number>;
};

function catalogRow(
	id: number,
	name: string,
	serving: { label: string; grams: number },
	kcalPer100g: number
): ResolvedRow {
	return {
		id,
		name,
		brand: null,
		kind: 'generic',
		category: null,
		barcode: null,
		license: 'PDDL-1.0',
		serving,
		per100g: {
			kcal: kcalPer100g,
			protein: 0,
			fat: 0,
			carbs: 0,
			sugar: 0,
			fiber: 0,
			sodium: 0,
			saturatedFat: 0
		}
	};
}

/** 50 g and 72 kcal a large egg, which is what "two eggs" comes to two of. */
export const EGG_ROW = catalogRow(101, 'Egg, large', { label: '1 large', grams: 50 }, 144);

/** 14 g and 119 kcal a tablespoon, so "2 tablespoons" is two servings and 238 kcal. */
export const OLIVE_OIL_ROW = catalogRow(103, 'Olive oil', { label: '1 tbsp', grams: 14 }, 850);

/**
 * Answer `POST /api/foods/resolve` with these rows, one per name asked about
 * and in that order, so a typed sentence resolves without a catalog file.
 */
export async function stubFoodResolve(page: Page, rows: (ResolvedRow | null)[]): Promise<void> {
	await page.route('**/api/foods/resolve', async (route) => {
		const body = route.request().postDataJSON() as { queries?: string[] };
		const queries = body.queries ?? [];
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items: queries.map((query, index) => ({
					query,
					food: rows[index] ?? null,
					alternatives: []
				}))
			})
		});
	});
}

/**
 * Open the log sheet and type into its box.
 *
 * The wait is the point. `Sheet` moves focus into itself a tick after the
 * dialog mounts — it comes to rest on the sheet's own `Close` button — and
 * `fill` is two round trips: it focuses the box, then sends the text to
 * whichever element holds focus when the text arrives. Filling before that
 * move has landed sends `two eggs` to the button instead. Nothing errors; the
 * box is simply still empty, so `Parse` stays disabled and the test times out
 * thirty seconds later pointing at a button rather than at the typing that
 * never happened. That is what failed on mobile-safari in run 33900350109,
 * where the snapshot caught focus resting on `Close` with the box empty.
 *
 * The value is read back afterwards so that a binding which stops carrying the
 * text fails here, naming the box, instead of as a timeout further down.
 */
export async function openLogSheetAndType(page: Page, what: string): Promise<void> {
	await openLogSheet(page);
	// The sheet opens on Search now; the typed box lives on the Type tab.
	await page.getByRole('button', { name: 'Type', exact: true }).click();
	const box = page.getByLabel('What you ate');
	await box.fill(what);
	await expect(box).toHaveValue(what);
}

/**
 * Open the log sheet and wait out the same focus move `openLogSheetAndType`
 * documents, without assuming which tab or field comes next — callers that
 * switch tabs (e.g. to Scan) before typing anything share this wait instead
 * of re-deriving it.
 */
export async function openLogSheet(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Log food' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
}

/**
 * Onboard onto the seeded journal, so there is a day's log to read.
 *
 * No `page.goto` of its own, unlike `openEmptyJournal`: some callers are
 * already on the first run when they reach it, having just registered or just
 * come back to a device, and navigating again would throw that state away. The
 * ones that do need it navigate for themselves on the line above.
 */
export async function openSampleJournal(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('button', { name: 'Open the sample journal' }).click();
	await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

/** Onboard onto an empty journal, so anything logged afterwards is logged here. */
export async function openEmptyJournal(page: Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('button', { name: 'Start empty' }).click();
	await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

/**
 * Asserts nothing overflows the viewport at the page's current size.
 *
 * `document.documentElement.scrollWidth <= clientWidth` catches page-level
 * horizontal overflow wherever it comes from — the check #133's day strip
 * needed and no project's default width ever exercised. When `locator` is
 * passed too, its own box must also sit inside the viewport: a
 * `position: absolute` element scrolled out of flow could leave the document
 * itself un-widened while still spilling off screen. On failure the message
 * names the overflowing width, so a failing run does not need a debugger to
 * find it.
 */
export async function expectFitsViewport(page: Page, locator?: Locator): Promise<void> {
	const { scrollWidth, clientWidth } = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	expect(
		scrollWidth,
		`document.documentElement.scrollWidth is ${scrollWidth}px, wider than the ${clientWidth}px viewport`
	).toBeLessThanOrEqual(clientWidth);

	if (locator === undefined) return;
	const box = await locator.boundingBox();
	expect(box, 'element has no box to measure — is it visible?').not.toBeNull();
	const { x, width } = box as { x: number; width: number };
	const rightEdge = x + width;
	expect(
		rightEdge,
		`element's right edge is at ${rightEdge}px, past the ${clientWidth}px viewport`
	).toBeLessThanOrEqual(clientWidth);
	expect(x, `element's left edge is at ${x}px, left of the viewport`).toBeGreaterThanOrEqual(0);
}

/**
 * 360×800: the width #133's day strip overflowed at and no project in
 * `scripts/quality/e2e-projects.ts` emulates by default (Pixel 7 is 412px,
 * iPhone 15 is 393px). #152.
 */
export async function atNarrowPhone(page: Page): Promise<void> {
	await page.setViewportSize({ width: 360, height: 800 });
}

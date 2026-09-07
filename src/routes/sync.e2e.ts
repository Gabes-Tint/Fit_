import { expect, type Browser, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	freshUsername,
	openEmptyJournal,
	openLogSheetAndType,
	returnThroughApi,
	signInThroughApi,
	signOutThroughDrawer,
	stubFoodResolve
} from '../../tests/e2e-support';

/**
 * The data follows the account, not the phone.
 *
 * Most of what is below is two devices: one that records something and one that
 * signs in afterwards and must find it. The second is a real second browser
 * context, so it shares nothing with the first but the account.
 */

const PASSWORD = 'salt-and-pepper-mill';

async function logTwoEggs(page: Page) {
	// Naming the food is the server's job since #116, and this preview server
	// has no catalog file; the sync behavior under test is unaffected by it.
	await stubFoodResolve(page, [EGG_ROW]);
	await openLogSheetAndType(page, 'two eggs');
	await page.getByRole('button', { name: 'Parse' }).click();
	await page.getByRole('button', { name: 'Add to today' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByText('Egg, large')).toBeVisible();
}

/** The sync record as the device holds it: how far it has got, and what is unsent. */
function syncRecord(page: Page): Promise<{ version: number; dirty: boolean } | null> {
	return page.evaluate(() => {
		const raw = globalThis.localStorage.getItem('tend.sync.v1');
		return raw === null ? null : (JSON.parse(raw) as { version: number; dirty: boolean });
	});
}

function storedDocument(page: Page): Promise<string | null> {
	return page.evaluate(() => globalThis.localStorage.getItem('tend.v1'));
}

/**
 * Wait until this device has sent everything it holds.
 *
 * `timeout: 20_000` on every `expect.poll` in this file, above the sync
 * client's `REQUEST_TIMEOUT_MS` (10_000, `src/lib/state/sync.svelte.ts`):
 * Playwright's default 5 s `expect` timeout gave up before one aborted
 * attempt could even finish, which #125 found behind two of its five flakes.
 *
 * The timed retry added for #193 is why a dropped attempt now recovers at all
 * rather than stalling here for ever, but it does not shorten this wait: the
 * window it has to cover is an attempt aborting at ten seconds, the first step
 * of a second, and the round trip after it. Twenty is that with room, and a
 * poll only costs the time it actually takes.
 */
async function settled(page: Page) {
	await expect
		.poll(async () => (await syncRecord(page))?.dirty ?? true, { timeout: 20_000 })
		.toBe(false);
	await expect
		.poll(async () => (await syncRecord(page))?.version ?? 0, { timeout: 20_000 })
		.toBeGreaterThan(0);
}

/** A second device: its own context, its own storage, the same account. */
async function otherDevice(browser: Browser, baseURL: string, username: string): Promise<Page> {
	const context = await browser.newContext({ baseURL });
	const page = await context.newPage();
	await returnThroughApi(page, baseURL, username);
	return page;
}

test.describe('what one device recorded', () => {
	/**
	 * Set up once for the whole group: the first device logs a food and finishes
	 * a session, and the second signs in and opens the app. Each test then asks
	 * one question of the second device.
	 */
	let second: Page | undefined;

	test.beforeEach(async ({ page, browser, baseURL }) => {
		const username = await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await logTwoEggs(page);

		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		await settled(page);

		second = await otherDevice(browser, baseURL ?? '', username);
		await second.goto('/');
	});

	test.afterEach(async () => {
		await second?.context().close();
		second = undefined;
	});

	/** The second device, or a failure that says so rather than a type error. */
	function arrived(): Page {
		if (second === undefined) throw new Error('the second device never opened');
		return second;
	}

	test('is on today’s log on the next device to sign in', async () => {
		await expect(arrived().getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
		await expect(arrived().getByText('Egg, large')).toBeVisible();
	});

	test('brings the profile with it, so onboarding is not asked again', async () => {
		await expect(arrived().getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
		await expect(arrived().getByRole('heading', { name: 'Tend' })).toHaveCount(0);
	});

	test('puts the finished session into training progress there', async () => {
		await arrived().goto('/exercise/progress');
		// The charts stand in for one finished session that actually trained, and
		// nothing else puts them on the page, so this is the workout having
		// crossed devices rather than the screen merely loading.
		await expect(arrived().getByRole('heading', { name: 'Heaviest so far' })).toBeVisible();
		await expect(arrived().getByText(/nothing here to chart/)).toHaveCount(0);
	});
});

test.describe('signing out', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await logTwoEggs(page);
		await settled(page);
		await signOutThroughDrawer(page);
	});

	test('leaves neither the journal nor the sync record on the device', async ({ page }) => {
		expect(await storedDocument(page)).toBeNull();
		expect(await syncRecord(page)).toBeNull();
	});

	test('shows the next account its own start, not the last one’s log', async ({
		page,
		baseURL
	}) => {
		const next = freshUsername();
		const response = await page.request.post('/api/accounts', {
			headers: { origin: new URL(baseURL ?? '').origin },
			data: {
				username: next,
				displayName: 'Sam',
				password: PASSWORD,
				householdName: 'Flat'
			}
		});
		expect(response.status()).toBe(201);

		await page.getByLabel('Username').fill(next);
		await page.getByLabel('Password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByRole('heading', { name: 'Tend' })).toBeVisible();
		await expect(page.getByText('Egg, large')).toHaveCount(0);
	});
});

test.describe('with the server out of reach', () => {
	test('logs the food anyway, and sends it once the route is open again', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await settled(page);

		const accepted: number[] = [];
		page.on('response', (response) => {
			if (response.url().endsWith('/api/state') && response.request().method() === 'PUT') {
				accepted.push(response.status());
			}
		});
		await page.route('**/api/state', (route) => route.abort());

		await logTwoEggs(page);
		await expect
			.poll(async () => (await syncRecord(page))?.dirty ?? false, { timeout: 20_000 })
			.toBe(true);

		await page.unroute('**/api/state');
		// One of the three moments a device that could not reach the server tries again.
		await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));

		await expect
			.poll(() => accepted.filter((status) => status === 200).length, { timeout: 20_000 })
			.toBeGreaterThan(0);
		await settled(page);
	});
});

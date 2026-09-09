import { expect, type Browser, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	freshUsername,
	OLIVE_OIL_ROW,
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

	/**
	 * The other half of the same criterion: progress charts prove the session
	 * crossed, and this proves the week it belongs to crossed with it. They are
	 * two different readings of `workouts` — one over all of history, one over
	 * the current week — and a document that arrived without dates would satisfy
	 * the first and not this.
	 */
	test('counts the finished session in this week’s training there', async () => {
		await expect(arrived().getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
		await expect(arrived().getByRole('group', { name: "This week's training" })).toContainText(
			/\b1 (of \d+ )?sessions? this week/
		);
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

/**
 * The conflict rule, with two devices rather than a stubbed answer.
 *
 * Both hold the account's document. One moves on; the other, still at the
 * version it last agreed on, logs something of its own and is refused. What it
 * must not do is push over the newer document, and what it must not do quietly
 * is replace what the person on it just logged. Merging the two is a later
 * story and deliberately not what happens here.
 */
test.describe('two devices that edited while apart', () => {
	test('leave the one that is behind holding the newer document, and told so', async ({
		page,
		browser,
		baseURL
	}) => {
		const username = await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await settled(page);

		// The second device takes the account's document, so both now agree on a
		// version. Nothing after this is a device merely catching up for the first
		// time; they have genuinely diverged.
		const second = await otherDevice(browser, baseURL ?? '', username);
		await second.goto('/');
		await expect(second.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
		await settled(second);

		// The first device moves the account on while the second is not looking.
		await logTwoEggs(page);
		await settled(page);

		// And now the second logs something of its own, from the version it last
		// agreed on. Its write is refused, and what comes back is the eggs.
		await stubFoodResolve(second, [OLIVE_OIL_ROW]);
		await openLogSheetAndType(second, '2 tablespoons olive oil');
		await second.getByRole('button', { name: 'Parse' }).click();
		await second.getByRole('button', { name: 'Add to today' }).click();
		await expect(second.getByRole('dialog')).toBeHidden();

		await expect(
			second.getByText('This device was behind, so it reloaded your newer data.')
		).toBeVisible();
		await expect(second.getByText('Egg, large')).toBeVisible();
		// Not merged, which is what the story says and what the message means: the
		// oil was refused, and the person was told rather than left to notice.
		await expect(second.getByText('Olive oil')).toHaveCount(0);

		await second.context().close();
	});
});

/**
 * #247. Saving writes to the device the instant the tap lands, and that half was
 * never in doubt. What could take the save away again was the reload: a write
 * already in the air reaches the server, its answer does not reach the device,
 * and the next start finds the account a version ahead. That version is this
 * device's own document from a moment ago — but it was read as another device's
 * newer work and adopted, and everything recorded since the write left went with
 * it. It failed as an intermittent height flake on the You screen; nothing about
 * it is particular to height, or to that screen.
 *
 * Passing the write on and dropping its answer is the only thing done to the
 * network here, and it is what makes the window certain instead of a matter of
 * luck. The reload still happens the instant the tap returns.
 */
test.describe('a write whose answer never arrives', () => {
	test('does not take the next save down with it', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await settled(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'You' }).click();
		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		/** Writes the account has taken and this device has been told nothing about. */
		let unanswered = 0;
		/** Writes inside the handler right now. The page must not move while any is. */
		let beingDropped = 0;
		/** Dropped until the page has moved on; after that the account answers as it does. */
		let dropAnswers = true;
		/*
		 * The answer this device is never told about. `route.fetch` sends the write
		 * on, so the account takes it, and `route.abort` drops the answer on the way
		 * back, as a connection that dies under an answered request would — which
		 * is what a reload does to a request in the air anyway.
		 *
		 * Both halves happen inside the handler, and that is the point. A handler
		 * still parked when the interception comes down is answered by Playwright
		 * itself: removing the last handler tells the browser to stop intercepting,
		 * and every route still held inside a handler is continued on the way past
		 * (`removeRequestInterceptor`). The `route.fulfill` this test used to make
		 * after a timer was then answering a request already answered —
		 * `Route is already handled!`, a red mobile-safari shard about sync for a
		 * reason that was not about sync, and the same mechanism as #303 in
		 * `lazy-shell.e2e.ts`. Nothing is held here for anything to collide with.
		 */
		await page.route('**/api/state', async (route) => {
			if (!dropAnswers || route.request().method() !== 'PUT') return route.continue();
			beingDropped += 1;
			await route.fetch();
			await route.abort();
			beingDropped -= 1;
			unanswered += 1;
		});

		// The switch is what puts a write in the air; anything recorded a moment
		// before a save would do as well.
		await page.getByRole('button', { name: 'Imperial' }).click();
		await expect(page.getByLabel('Height, inches')).toHaveValue('6');
		await page.getByLabel('Height, feet').fill('5');
		await page.getByLabel('Height, inches').fill('9');
		await page.getByRole('button', { name: 'Save height' }).click();
		// The account is a version ahead of this device before the page moves,
		// rather than probably: a reload that beat every write to the server would
		// leave nothing to be mistaken for another device's work, and prove
		// nothing. And nothing is left inside the handler for the reload to take
		// the request out from under.
		await expect.poll(() => unanswered > 0 && beingDropped === 0, { timeout: 20_000 }).toBe(true);
		await page.reload();

		// The answers come back at their own pace again, so what the reloaded page
		// makes of the account is reached without waiting on anything.
		dropAnswers = false;
		await settled(page);
		await expect(page.getByLabel('Height, feet')).toHaveValue('5');
		await expect(page.getByLabel('Height, inches')).toHaveValue('9');

		// Taken down with the device idle — it has sent everything it holds — and
		// `wait` for whatever the handler may still be finishing, so no request
		// can be continued out from under it on the way down.
		await page.unrouteAll({ behavior: 'wait' });
	});
});

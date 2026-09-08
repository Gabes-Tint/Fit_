import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import LibrarySheet from './LibrarySheet.svelte';

async function renderSheet(taken: string[] = []) {
	const handlers = { onadd: vi.fn(), onclose: vi.fn() };
	await render(LibrarySheet, {
		props: { open: true, routineName: 'Push', taken, ...handlers }
	});
	await expect.element(page.getByRole('dialog')).toBeInTheDocument();
	return handlers;
}

describe('LibrarySheet', () => {
	it('says which routine it is adding to', async () => {
		await renderSheet();
		await expect.element(page.getByText('Adding to Push')).toBeInTheDocument();
	});

	it('offers the whole library until a group is chosen', async () => {
		await renderSheet();
		await expect.element(page.getByRole('checkbox', { name: 'Select Bench Press' })).toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Select Squat' })).toBeVisible();
	});

	it('narrows the list to one muscle group', async () => {
		await renderSheet();
		await page.getByRole('button', { name: 'Chest' }).click();
		await expect.element(page.getByRole('checkbox', { name: 'Select Bench Press' })).toBeVisible();
		expect(document.body.textContent).not.toContain('Squat');
	});

	it('does not offer what the routine already prescribes', async () => {
		await renderSheet(['Bench Press']);
		await expect.element(page.getByRole('checkbox', { name: 'Select Pec Deck' })).toBeVisible();
		expect(page.getByRole('checkbox', { name: 'Select Bench Press' }).elements()).toHaveLength(0);
	});

	it('asks for a pick before it will add anything', async () => {
		await renderSheet();
		await expect
			.element(page.getByRole('button', { name: 'Pick exercises to add' }))
			.toBeDisabled();
	});

	it('counts what has been picked', async () => {
		await renderSheet();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await page.getByRole('checkbox', { name: 'Select Deadlift' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Add 2 to the routine' }))
			.toBeInTheDocument();
	});

	it('drops a movement picked by mistake', async () => {
		await renderSheet();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Pick exercises to add' }))
			.toBeInTheDocument();
	});

	it('hands the picks over and closes', async () => {
		const { onadd, onclose } = await renderSheet();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await page.getByRole('button', { name: 'Add 1 to the routine' }).click();
		expect(onadd).toHaveBeenCalledWith(['Squat']);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('forgets the selection when it is dismissed', async () => {
		const { onadd, onclose } = await renderSheet();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await page.getByRole('button', { name: 'Close' }).click();
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(onadd).not.toHaveBeenCalled();
		await expect
			.element(page.getByRole('button', { name: 'Pick exercises to add' }))
			.toBeInTheDocument();
	});

	it('offers a form check from the list', async () => {
		await renderSheet();
		await page.getByRole('button', { name: 'Watch Squat' }).click();
		expect(document.body.textContent).toContain('Bar over mid-foot');
	});

	it('says so when a group has nothing left to offer', async () => {
		await renderSheet(['Barbell Curl', 'Hammer Curl', 'Preacher Curl']);
		await page.getByRole('button', { name: 'Biceps' }).click();
		await expect.element(page.getByText(/already on the routine/)).toBeInTheDocument();
	});

	it('narrows the list by typing a name', async () => {
		await renderSheet();
		await page.getByLabelText('Search exercises').fill('squat');
		await expect.element(page.getByRole('checkbox', { name: 'Select Squat' })).toBeVisible();
		expect(document.body.textContent).not.toContain('Bench Press');
	});

	it('still hides what the routine already prescribes while searching', async () => {
		await renderSheet(['Bench Press']);
		await page.getByLabelText('Search exercises').fill('press');
		await expect.element(page.getByRole('checkbox', { name: 'Select Leg Press' })).toBeVisible();
		expect(page.getByRole('checkbox', { name: 'Select Bench Press' }).elements()).toHaveLength(0);
	});

	it('says so in words when a search matches nothing', async () => {
		await renderSheet();
		await page.getByLabelText('Search exercises').fill('tyre flip');
		await expect
			.element(page.getByText('Nothing in the library matches "tyre flip".'))
			.toBeInTheDocument();
	});

	it('keeps a pick that a later query hides', async () => {
		const { onadd } = await renderSheet();
		await page.getByRole('checkbox', { name: 'Select Squat' }).click();
		await page.getByLabelText('Search exercises').fill('bench');
		await expect
			.element(page.getByRole('button', { name: 'Add 1 to the routine' }))
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Add 1 to the routine' }).click();
		expect(onadd).toHaveBeenCalledWith(['Squat']);
	});
});

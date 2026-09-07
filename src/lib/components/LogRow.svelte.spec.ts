import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { logFromFood } from '$lib/domain/log-entry';
import { tend } from '$lib/state/tend.svelte';
import LogRow from './LogRow.svelte';

function item() {
	return logFromFood({
		foodId: 'egg-large',
		servings: 2,
		meal: 'breakfast',
		date: '2026-06-01',
		source: 'manual'
	});
}

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('LogRow', () => {
	it('names the entry', async () => {
		await render(LogRow, { props: { item: item(), open: false, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByText(item().name)).toBeInTheDocument();
	});

	it('shows the servings against the serving label', async () => {
		const entry = item();
		await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByText(`2 × ${entry.servingLabel}`)).toBeInTheDocument();
	});

	it('says how many millilitres a volume serving is', async () => {
		// A serving of 2% milk is one cup; the millilitres are the unit's own
		// definition, so they can be shown without knowing the food.
		const entry = logFromFood({
			foodId: 'milk-2',
			servings: 2,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByText('2 × 1 cup (240 ml)')).toBeInTheDocument();
	});

	it('shows the energy', async () => {
		const entry = item();
		await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByText(String(entry.kcal))).toBeInTheDocument();
	});

	it('shows a provenance badge for a catalog-backed entry', async () => {
		await render(LogRow, { props: { item: item(), open: false, step: 0.5, ontoggle: vi.fn() } });
		expect(document.querySelector('[title]')).not.toBeNull();
	});

	it('shows no provenance badge for a custom entry', async () => {
		const custom = { ...item(), provenance: undefined };
		await render(LogRow, { props: { item: custom, open: false, step: 0.5, ontoggle: vi.fn() } });
		expect(document.querySelector('[title]')).toBeNull();
	});

	it('keeps the editing controls hidden while collapsed', async () => {
		await render(LogRow, { props: { item: item(), open: false, step: 0.5, ontoggle: vi.fn() } });
		expect(document.body.textContent).not.toContain('Remove');
	});

	it('reveals the editing controls when expanded', async () => {
		await render(LogRow, { props: { item: item(), open: true, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
	});

	it('reports its expanded state to assistive technology', async () => {
		const entry = item();
		await render(LogRow, { props: { item: entry, open: true, step: 0.5, ontoggle: vi.fn() } });
		await expect.element(page.getByRole('button', { expanded: true })).toBeInTheDocument();
	});

	it('asks to be toggled when tapped', async () => {
		const ontoggle = vi.fn();
		const entry = item();
		await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle } });
		await page
			.getByRole('button', { name: new RegExp(entry.name) })
			.first()
			.click();
		expect(ontoggle).toHaveBeenCalled();
	});

	it('writes a serving change through to the store', async () => {
		const update = vi.spyOn(tend, 'updateLog').mockImplementation(() => undefined);
		await render(LogRow, { props: { item: item(), open: true, step: 0.5, ontoggle: vi.fn() } });
		await page.getByRole('button', { name: 'Increase' }).click();
		expect(update).toHaveBeenCalledWith(expect.any(String), { servings: 2.5 });
	});

	describe('the unit toggle (#178)', () => {
		function unitItem(servings = 2) {
			return logFromFood({
				foodId: 'egg-mcmuffin',
				servings,
				meal: 'breakfast',
				date: '2026-06-01',
				source: 'manual'
			});
		}

		it('defaults to the unit count when the food names one', async () => {
			const entry = unitItem();
			await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
			await expect.element(page.getByText('2 sandwiches')).toBeInTheDocument();
		});

		it('offers no toggle for a food that names no usable unit', async () => {
			await render(LogRow, { props: { item: item(), open: true, step: 0.5, ontoggle: vi.fn() } });
			expect(page.getByLabelText('Show weight').elements()).toHaveLength(0);
			expect(page.getByLabelText('Show unit count').elements()).toHaveLength(0);
		});

		it('switches to the weight view without changing the logged grams or kcal', async () => {
			const entry = unitItem();
			const kcalBefore = entry.kcal;
			await render(LogRow, { props: { item: entry, open: true, step: 0.5, ontoggle: vi.fn() } });
			await page.getByLabelText('Show weight').click();
			await expect.element(page.getByText(`2 × ${entry.servingLabel}`)).toBeInTheDocument();
			expect(entry.kcal).toBe(kcalBefore);
			expect(entry.servings).toBe(2);
		});

		it('steps by whole units in the unit view', async () => {
			const update = vi.spyOn(tend, 'updateLog').mockImplementation(() => undefined);
			await render(LogRow, {
				props: { item: unitItem(), open: true, step: 0.5, ontoggle: vi.fn() }
			});
			await page.getByRole('button', { name: 'Increase' }).click();
			expect(update).toHaveBeenCalledWith(expect.any(String), { servings: 3 });
		});

		it('steps by the passed serving step once switched to the weight view', async () => {
			const update = vi.spyOn(tend, 'updateLog').mockImplementation(() => undefined);
			await render(LogRow, {
				props: { item: unitItem(), open: true, step: 0.5, ontoggle: vi.fn() }
			});
			await page.getByLabelText('Show weight').click();
			await page.getByRole('button', { name: 'Increase' }).click();
			expect(update).toHaveBeenCalledWith(expect.any(String), { servings: 2.5 });
		});
	});

	it('removes the entry through the store', async () => {
		const remove = vi.spyOn(tend, 'removeLog').mockImplementation(() => undefined);
		const entry = item();
		await render(LogRow, { props: { item: entry, open: true, step: 0.5, ontoggle: vi.fn() } });
		await page.getByRole('button', { name: 'Remove' }).click();
		expect(remove).toHaveBeenCalledWith(entry.id);
	});

	it('follows the entry when its servings change', async () => {
		const props = $state({ item: item(), open: false, step: 0.5, ontoggle: vi.fn() });
		await render(LogRow, { props });
		props.item = { ...props.item, servings: 3, kcal: 234 };
		await expect.element(page.getByText(`3 × ${props.item.servingLabel}`)).toBeInTheDocument();
	});

	describe('the nutrition facts sheet', () => {
		it('opens with the item’s name as its title when the ⓘ is tapped', async () => {
			const entry = item();
			await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
			await page.getByLabelText(`Nutrition facts for ${entry.name}`).click();
			await expect.element(page.getByRole('heading', { name: entry.name })).toBeInTheDocument();
		});

		it('shows the logged sodium and potassium, already scaled onto the servings', async () => {
			const entry = item();
			await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
			await page.getByLabelText(`Nutrition facts for ${entry.name}`).click();
			await expect.element(page.getByText('Sodium')).toBeInTheDocument();
			await expect.element(page.getByText(`${entry.micros.sodium} mg`)).toBeInTheDocument();
			await expect.element(page.getByText('Potassium')).toBeInTheDocument();
			await expect.element(page.getByText(`${entry.micros.potassium} mg`)).toBeInTheDocument();
		});

		it('does not toggle the row open when the ⓘ is tapped', async () => {
			const ontoggle = vi.fn();
			const entry = item();
			await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle } });
			await page.getByLabelText(`Nutrition facts for ${entry.name}`).click();
			expect(ontoggle).not.toHaveBeenCalled();
		});

		it('is a real button a keyboard can focus and activate', async () => {
			const entry = item();
			await render(LogRow, { props: { item: entry, open: false, step: 0.5, ontoggle: vi.fn() } });
			const info = page.getByLabelText(`Nutrition facts for ${entry.name}`);
			await expect.element(info).toBeInTheDocument();
			const el = info.element() as HTMLButtonElement;
			el.focus();
			expect(document.activeElement).toBe(el);
			el.click();
			await expect.element(page.getByRole('heading', { name: entry.name })).toBeInTheDocument();
		});
	});
});

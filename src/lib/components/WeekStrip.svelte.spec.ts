import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { addDaysISO, todayISO } from '$lib/domain/utils';
import { dayStripAccessibleLabel } from '$lib/domain/week-strip';
import WeekStrip from './WeekStrip.svelte';

const empty = () => new Set<string>();

describe('WeekStrip', () => {
	it('shows the full 38-day range', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect.element(page.getByRole('button').first()).toBeInTheDocument();
		expect(document.querySelectorAll('button')).toHaveLength(38);
	});

	it('labels today by weekday and date, same as any other day', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect
			.element(
				page.getByRole('button', {
					name: dayStripAccessibleLabel(todayISO(), 'nothing logged', true),
					exact: true
				})
			)
			.toBeInTheDocument();
	});

	it('labels the other days by weekday and date', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect
			.element(
				page.getByRole('button', {
					name: dayStripAccessibleLabel(yesterday, 'nothing logged', false),
					exact: true
				})
			)
			.toBeInTheDocument();
	});

	it('gives every pill a unique accessible name, even across a Feb/Mar visible-label overlap', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const names = Array.from(document.querySelectorAll('button')).map((button) =>
			button.getAttribute('aria-label')
		);
		expect(new Set(names).size).toBe(names.length);
	});

	it("gives today's pill an accessible name starting with Today", async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect.element(page.getByRole('button', { name: /^Today/ })).toBeInTheDocument();
	});

	it('rings today when it is not the selected day', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: yesterday }
		});
		const todayButton = page.getByRole('button', { name: /^Today/ }).element() as HTMLElement;
		expect(todayButton.className).toContain('ring-primary');
	});

	it('drops the ring from today once it is the selected day', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const todayButton = page.getByRole('button', { name: /^Today/ }).element() as HTMLElement;
		expect(todayButton.className).not.toContain('ring-primary');
	});

	it('gives a non-today pill no ring regardless of selection', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: yesterday }
		});
		const yesterdayButton = page
			.getByRole('button', { name: dayStripAccessibleLabel(yesterday, 'nothing logged', false) })
			.element() as HTMLElement;
		expect(yesterdayButton.className).not.toContain('ring-primary');
	});

	it('marks the selected day as pressed', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect
			.element(page.getByRole('button', { name: /Today/ }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('selects the day that was tapped', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		const props = $state({
			food: empty(),
			exercise: empty(),
			weight: empty(),
			selected: todayISO()
		});
		await render(WeekStrip, { props });
		await page
			.getByRole('button', {
				name: dayStripAccessibleLabel(yesterday, 'nothing logged', false),
				exact: true
			})
			.click();
		expect(props.selected).toBe(yesterday);
	});

	it('marks a logged day that is not selected in the primary color', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: {
				food: new Set([yesterday]),
				exercise: empty(),
				weight: empty(),
				selected: todayISO()
			}
		});
		expect(document.querySelectorAll('.text-primary').length).toBeGreaterThan(0);
	});

	it('leaves an unlogged day with faint icons', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const yesterdayPill = page
			.getByRole('button', { name: dayStripAccessibleLabel(yesterday, 'nothing logged', false) })
			.element() as HTMLElement;
		expect(yesterdayPill.querySelectorAll('svg.text-muted-foreground\\/50')).toHaveLength(3);
	});

	it('marks the selected day that was logged in the primary-foreground color', async () => {
		await render(WeekStrip, {
			props: {
				food: new Set([todayISO()]),
				exercise: empty(),
				weight: empty(),
				selected: todayISO()
			}
		});
		const todayPill = page.getByRole('button', { name: /^Today/ }).element() as HTMLElement;
		expect(todayPill.querySelectorAll('svg.text-primary-foreground')).toHaveLength(1);
	});

	it('shows only the food icon coloured when only food was logged', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: {
				food: new Set([yesterday]),
				exercise: empty(),
				weight: empty(),
				selected: todayISO()
			}
		});
		await expect.element(page.getByRole('button', { name: /food logged/ })).toBeInTheDocument();
	});

	it('names all three when food, exercise and weight were all logged', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(WeekStrip, {
			props: {
				food: new Set([yesterday]),
				exercise: new Set([yesterday]),
				weight: new Set([yesterday]),
				selected: todayISO()
			}
		});
		await expect
			.element(page.getByRole('button', { name: /food, exercise, weight logged/ }))
			.toBeInTheDocument();
	});

	it('says nothing logged for a day with no marks', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		await expect
			.element(page.getByRole('button', { name: /nothing logged/ }).first())
			.toBeInTheDocument();
	});

	it('keeps exactly one pill tabbable, the selected one', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const tabbable = buttons.filter((button) => button.tabIndex === 0);
		expect(tabbable).toHaveLength(1);
		expect(tabbable[0]).toBe(
			page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement
		);
	});

	it('moves focus to the next pill on ArrowRight', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const todayIndex = buttons.indexOf(
			page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement
		);
		const todayButton = buttons[todayIndex];
		todayButton?.focus();
		todayButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(buttons[todayIndex + 1]);
	});

	it('moves focus to the previous pill on ArrowLeft', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const todayIndex = buttons.indexOf(
			page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement
		);
		const todayButton = buttons[todayIndex];
		todayButton?.focus();
		todayButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(buttons[todayIndex - 1]);
	});

	it('keeps focus on the first pill when ArrowLeft is pressed there', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const firstButton = buttons[0];
		firstButton?.focus();
		firstButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(firstButton);
	});

	it('keeps focus on the last pill when ArrowRight is pressed there', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const lastButton = buttons[buttons.length - 1];
		lastButton?.focus();
		lastButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(lastButton);
	});

	it('moves focus to the first pill on Home', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const todayButton =
			buttons[
				buttons.indexOf(page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement)
			];
		todayButton?.focus();
		todayButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(buttons[0]);
	});

	it('moves focus to the last pill on End', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const todayButton =
			buttons[
				buttons.indexOf(page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement)
			];
		todayButton?.focus();
		todayButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(buttons[buttons.length - 1]);
	});

	it('ignores an unrelated key and leaves focus where it was', async () => {
		await render(WeekStrip, {
			props: { food: empty(), exercise: empty(), weight: empty(), selected: todayISO() }
		});
		const buttons = Array.from(document.querySelectorAll('button'));
		const todayButton =
			buttons[
				buttons.indexOf(page.getByRole('button', { name: /^Today/ }).element() as HTMLButtonElement)
			];
		todayButton?.focus();
		todayButton?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(todayButton);
	});
});

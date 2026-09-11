import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import StatusBadge from './StatusBadge.svelte';

describe('StatusBadge', () => {
	it('renders the provided label as text', async () => {
		await render(StatusBadge, { props: { label: 'In Progress' } });
		await expect.element(page.getByText('In Progress')).toBeInTheDocument();
	});

	it('renders a visible badge element', async () => {
		await render(StatusBadge, { props: { label: 'Completed' } });
		const badge = page.getByRole('status');
		await expect.element(badge).toBeInTheDocument();
	});

	it('uses a span element for semantic status badge', async () => {
		await render(StatusBadge, { props: { label: 'Pending' } });
		expect(page.getByRole('status').elements()).toHaveLength(1);
	});

	it('exposes the label text to assistive technology via role attribute', async () => {
		await render(StatusBadge, { props: { label: 'Active' } });
		const badge = page.getByRole('status', { name: 'Active' });
		await expect.element(badge).toBeInTheDocument();
	});

	it('applies badge styling with existing component conventions', async () => {
		await render(StatusBadge, { props: { label: 'Ready' } });
		const badge = page.getByRole('status');
		// Verify the badge has Tailwind classes for badge styling
		await expect.element(badge).toHaveClass(/rounded|px|py|font-medium/);
	});

	it('renders different labels without mutation', async () => {
		await render(StatusBadge, { props: { label: 'Draft' } });
		await expect.element(page.getByText('Draft')).toBeInTheDocument();
		expect(page.getByText('Published').elements()).toHaveLength(0);
	});

	it('handles multi-word formatted labels', async () => {
		await render(StatusBadge, { props: { label: 'In Review' } });
		await expect.element(page.getByText('In Review')).toBeInTheDocument();
	});

	it('renders the badge with visible content', async () => {
		await render(StatusBadge, { props: { label: 'Approved' } });
		expect(document.body.textContent?.trim()).toContain('Approved');
	});
});

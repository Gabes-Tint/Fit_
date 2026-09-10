import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import BrandLabel from './BrandLabel.svelte';

describe('BrandLabel', () => {
	it('names the brand a product is sold under (#337)', async () => {
		await render(BrandLabel, { props: { brand: 'CLAEYS' } });
		await expect.element(page.getByText('CLAEYS')).toBeInTheDocument();
	});

	it('renders nothing at all for a food with no brand', async () => {
		await render(BrandLabel, { props: {} });
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('renders nothing for a brand the catalog carried through as blank', async () => {
		await render(BrandLabel, { props: { brand: '   ' } });
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('leaves the brand as the source spelled it, rather than restyling the text', async () => {
		// The capitals are CSS, so a brand written "Trader Joe's" reads as its
		// own name to anything reading the page rather than looking at it.
		await render(BrandLabel, { props: { brand: "Trader Joe's" } });
		await expect.element(page.getByText("Trader Joe's")).toBeInTheDocument();
	});
});

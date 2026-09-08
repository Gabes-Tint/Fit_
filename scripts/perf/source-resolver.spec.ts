import { describe, expect, it } from 'vitest';
import { rewriteSpecifier } from './source-resolver.ts';

const parent = new URL('../../src/lib/server/catalog/portions.ts', import.meta.url).href;
const always = () => true;
const never = () => false;

describe('rewriteSpecifier', () => {
	it('points $lib at src/lib, which is what SvelteKit means by it', () => {
		expect(rewriteSpecifier('$lib/domain/portions', parent, always)).toBe(
			new URL('../../src/lib/domain/portions.ts', import.meta.url).href
		);
	});

	it('adds the extension a relative TypeScript import omits', () => {
		expect(rewriteSpecifier('./statements', parent, always)).toBe('./statements.ts');
	});

	it('leaves a relative specifier alone when no such TypeScript file exists', () => {
		expect(rewriteSpecifier('./statements', parent, never)).toBe('./statements');
	});

	it('leaves a specifier that already names its extension alone', () => {
		expect(rewriteSpecifier('./statements.ts', parent, always)).toBe('./statements.ts');
		expect(rewriteSpecifier('./byproducts.js', parent, always)).toBe('./byproducts.js');
	});

	it('leaves a bare package specifier to Node', () => {
		expect(rewriteSpecifier('node:sqlite', parent, always)).toBe('node:sqlite');
		expect(rewriteSpecifier('prettier', parent, always)).toBe('prettier');
	});
});

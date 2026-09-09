import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `--shadow-border` is the one design token in this app with a frame-rate
 * consequence, and nothing else in the toolchain would notice it changing.
 *
 * #292 bisected the stylesheet three ways -- by rule, by rule count, and
 * finally by applied property -- to find out why a route change costs hosted
 * WebKit ~900 ms per actionability check and Chromium 40 ms. Of six property
 * families rewritten in place on an otherwise identical page, exactly one
 * moved: box-shadow. Radius, overflow, sticky/fixed, motion, background images
 * and even `filter`/`backdrop-filter` were each null on both rounds of two
 * runs.
 *
 * And within box-shadow it is the blur, not the layer count or the radius.
 * Emptying this single token took a WebKit route change from 895-939 ms to
 * 86-90 ms; keeping the token but dropping only its widest blurred layer left
 * it at 678 ms. A blurred shadow on 35 component sites is the cost; an
 * shadow with no blur is not.
 *
 * So the constraint a person cares about is not "keep this exact value" -- the
 * color, the alpha and the spread are all design's to choose. It is that every
 * layer's blur radius stays zero, because the first blurred layer someone adds
 * back takes the iOS app from responsive to visibly stalling on every
 * navigation, silently, with no test failing.
 */
const APP_CSS = new URL('./app.css', import.meta.url);

/**
 * The blur radius is the third length in a box-shadow layer (`offset-x offset-y
 * blur spread color`). A layer with fewer than three lengths has no blur at all.
 */
function blurRadii(token: string): readonly string[] {
	// Split on the commas that separate layers, not the ones inside `rgb(…)`.
	const layers = token.split(/,(?![^(]*\))/u);
	return layers.flatMap((layer) => {
		const lengths = layer
			.trim()
			.split(/\s+/u)
			.filter((part) => /^-?[\d.]/u.test(part));
		const blur = lengths[2];
		return blur === undefined ? [] : [blur];
	});
}

function shadowBorderToken(): string {
	const css = readFileSync(APP_CSS, 'utf8');
	const match = /--shadow-border:([^;]*);/u.exec(css);
	if (match?.[1] === undefined) throw new Error('src/app.css no longer declares --shadow-border.');
	return match[1].replace(/\s+/gu, ' ').trim();
}

describe('the --shadow-border token', () => {
	it('is declared', () => {
		expect(shadowBorderToken().length).toBeGreaterThan(0);
	});

	it('draws every layer without blur, because a blurred one stalls WebKit', () => {
		for (const blur of blurRadii(shadowBorderToken()))
			expect(Number.parseFloat(blur), `blur radius "${blur}" must be zero`).toBe(0);
	});

	it('sees a blurred layer, so the guard above cannot pass vacuously', () => {
		expect(blurRadii('0 0 0 1px rgb(31 27 22 / 0.06), 0 2px 8px 0 rgb(31 27 22 / 0.04)')).toEqual([
			'0',
			'8px'
		]);
	});

	it('reads a layer with no blur at all as having none', () => {
		expect(blurRadii('0 0 0 1px rgb(31 27 22 / 0.12)')).toEqual(['0']);
	});
});

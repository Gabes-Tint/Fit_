import { describe, expect, it } from 'vitest';
import {
	buildBudgetTable,
	chunkDeltas,
	formatBudgetTable,
	formatMetricDeltas,
	formatTopChunks,
	measure,
	metricDeltas,
	stableChunkName
} from './bundle-headroom';
import type { Asset, BundleReading } from './bundle-headroom';
import type { BundleBudgets } from './config-types';

const budgets: BundleBudgets = {
	alwaysLoadedJavaScriptBytes: 700,
	clientCssBytes: 100,
	clientJavaScriptBytes: 1000,
	largestAssetBytes: 500
};

function reading(assets: Asset[], alwaysLoadedJavaScriptBytes: number): BundleReading {
	return { measurement: measure(assets), alwaysLoadedJavaScriptBytes };
}

describe('measure', () => {
	it('sums JS and CSS separately and finds the largest asset regardless of extension', () => {
		const assets: Asset[] = [
			{ file: 'chunks/a.js', bytes: 300 },
			{ file: 'chunks/b.js', bytes: 200 },
			{ file: 'assets/app.css', bytes: 50 },
			{ file: 'nodes/big.js', bytes: 900 }
		];
		const measurement = measure(assets);
		expect(measurement.javascriptBytes).toBe(1400);
		expect(measurement.cssBytes).toBe(50);
		expect(measurement.largestAsset).toEqual({ file: 'nodes/big.js', bytes: 900 });
	});

	it('reports a zero-byte largest asset for an empty build', () => {
		expect(measure([]).largestAsset).toEqual({ file: '', bytes: 0 });
	});
});

describe('buildBudgetTable', () => {
	it('reports positive headroom under budget and negative headroom over budget', () => {
		const rows = buildBudgetTable(
			reading(
				[
					{ file: 'a.js', bytes: 900 },
					{ file: 'a.css', bytes: 150 }
				],
				750
			),
			budgets
		);
		expect(rows).toEqual([
			{ metric: 'JS', bytes: 900, budget: 1000, headroom: 100 },
			{ metric: 'JS always loaded', bytes: 750, budget: 700, headroom: -50 },
			{ metric: 'CSS', bytes: 150, budget: 100, headroom: -50 },
			{ metric: 'Largest asset', bytes: 900, budget: 500, headroom: -400 }
		]);
	});
});

describe('formatBudgetTable', () => {
	it('renders a header, a rule and one aligned row per metric', () => {
		const rows = buildBudgetTable(reading([{ file: 'a.js', bytes: 900 }], 600), budgets);
		const text = formatBudgetTable(rows);
		const lines = text.split('\n');
		expect(lines[0]).toContain('Metric');
		expect(lines[0]).toContain('Headroom');
		expect(lines).toHaveLength(2 + rows.length);
		expect(text).toContain('JS');
		expect(text).toContain('900');
	});
});

describe('stableChunkName', () => {
	it('strips a content hash between a stable name and the extension', () => {
		expect(stableChunkName('nodes/0.CgDJk-x6.js')).toBe('nodes/0.js');
		expect(stableChunkName('_app/app.BblYBM6V.css')).toBe('_app/app.css');
	});

	it('leaves a hash-only file name alone, since there is no stable part to keep', () => {
		expect(stableChunkName('chunks/aH2TVcHd.js')).toBe('chunks/aH2TVcHd.js');
	});
});

describe('chunkDeltas', () => {
	it('matches chunks by stable name across a hash change and reports the byte delta', () => {
		const before: Asset[] = [{ file: 'nodes/0.AAAA.js', bytes: 1000 }];
		const after: Asset[] = [{ file: 'nodes/0.BBBB.js', bytes: 1200 }];
		expect(chunkDeltas(before, after)).toEqual([
			{ name: 'nodes/0.js', beforeBytes: 1000, afterBytes: 1200, deltaBytes: 200 }
		]);
	});

	it('reports a chunk only in "after" as added from zero, and one only in "before" as removed to zero', () => {
		const before: Asset[] = [{ file: 'nodes/1.AAAA.js', bytes: 500 }];
		const after: Asset[] = [{ file: 'nodes/2.BBBB.js', bytes: 700 }];
		const deltas = chunkDeltas(before, after);
		expect(deltas).toContainEqual({
			name: 'nodes/1.js',
			beforeBytes: 500,
			afterBytes: 0,
			deltaBytes: -500
		});
		expect(deltas).toContainEqual({
			name: 'nodes/2.js',
			beforeBytes: 0,
			afterBytes: 700,
			deltaBytes: 700
		});
	});

	it('omits chunks whose size did not change and sorts the rest by |delta| descending', () => {
		const before: Asset[] = [
			{ file: 'a.AAAA.js', bytes: 100 },
			{ file: 'b.AAAA.js', bytes: 100 },
			{ file: 'c.AAAA.js', bytes: 100 }
		];
		const after: Asset[] = [
			{ file: 'a.BBBB.js', bytes: 100 },
			{ file: 'b.BBBB.js', bytes: 150 },
			{ file: 'c.BBBB.js', bytes: 500 }
		];
		const deltas = chunkDeltas(before, after);
		expect(deltas.map((delta) => delta.name)).toEqual(['c.js', 'b.js']);
	});
});

describe('metricDeltas', () => {
	it('reports before, after and the signed delta for each metric', () => {
		const before = reading([{ file: 'a.js', bytes: 1000 }], 800);
		const after = reading([{ file: 'a.js', bytes: 1200 }], 700);
		expect(metricDeltas(before, after)).toEqual([
			{ metric: 'JS', before: 1000, after: 1200, delta: 200 },
			{ metric: 'JS always loaded', before: 800, after: 700, delta: -100 },
			{ metric: 'CSS', before: 0, after: 0, delta: 0 },
			{ metric: 'Largest asset', before: 1000, after: 1200, delta: 200 }
		]);
	});

	it('shows the tree growing while the always-loaded closure shrinks, which is what a split does', () => {
		const deltas = metricDeltas(
			reading([{ file: 'a.js', bytes: 1000 }], 900),
			reading(
				[
					{ file: 'a.js', bytes: 700 },
					{ file: 'lazy.js', bytes: 400 }
				],
				700
			)
		);
		expect(deltas).toContainEqual({ metric: 'JS', before: 1000, after: 1100, delta: 100 });
		expect(deltas).toContainEqual({
			metric: 'JS always loaded',
			before: 900,
			after: 700,
			delta: -200
		});
	});
});

describe('formatMetricDeltas', () => {
	it('names the ref and signs a growth with a plus', () => {
		const text = formatMetricDeltas(
			[{ metric: 'JS', before: 1000, after: 1200, delta: 200 }],
			'origin/main'
		);
		expect(text).toContain('origin/main');
		expect(text).toContain('+200');
	});

	it('signs a shrink with a minus', () => {
		const text = formatMetricDeltas(
			[{ metric: 'JS', before: 1200, after: 1000, delta: -200 }],
			'origin/main'
		);
		expect(text).toContain('-200');
	});
});

describe('formatTopChunks', () => {
	it('caps the list at the requested count', () => {
		const deltas = Array.from({ length: 8 }, (_, index) => ({
			name: `chunk-${index}.js`,
			beforeBytes: 100,
			afterBytes: 100 + index,
			deltaBytes: index
		})).sort((a, b) => b.deltaBytes - a.deltaBytes);
		const text = formatTopChunks(deltas, 5);
		expect(text).toContain('Top 5 chunks by byte change');
		expect(text.split('\n')).toHaveLength(6);
	});

	it('says nothing changed size when there are no deltas', () => {
		expect(formatTopChunks([])).toBe('No chunk changed size.');
	});
});

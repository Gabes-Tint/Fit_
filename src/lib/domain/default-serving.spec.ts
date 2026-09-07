import { describe, expect, it } from 'vitest';
import { pickDefaultServing } from './default-serving';

describe('pickDefaultServing', () => {
	it('prefers a whole-item measure over other household measures', () => {
		expect(
			pickDefaultServing([
				{ label: '2 Tbsp', grams: 30 },
				{ label: '1.0 item 7.6 oz', grams: 219 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '1.0 item 7.6 oz', grams: 219 });
	});

	it('recognizes the whole-item spellings the ETL writes: "1 sandwich", "1 slice", "1 each"', () => {
		for (const label of ['1 sandwich', '1 slice (28 g)', '1 each']) {
			expect(pickDefaultServing([{ label, grams: 50 }])).toEqual({ label, grams: 50 });
		}
	});

	it('falls back to the first household measure when no whole-item measure is present', () => {
		expect(
			pickDefaultServing([
				{ label: '60190', grams: 205 },
				{ label: '64742', grams: 135 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '60190', grams: 205 });
	});

	it('answers null when only the guaranteed 100 g row is present', () => {
		expect(pickDefaultServing([{ label: '100 g', grams: 100 }])).toBeNull();
	});

	it('answers null when there are no rows at all', () => {
		expect(pickDefaultServing([])).toBeNull();
	});

	it('ignores a row with no usable weight', () => {
		expect(
			pickDefaultServing([
				{ label: '1 sandwich', grams: 0 },
				{ label: '1 slice', grams: 28 }
			])
		).toEqual({ label: '1 slice', grams: 28 });
	});
});

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

describe('pickDefaultServing — mutation-hardening cases', () => {
	it('trims a plain-grams label before recognizing it as the catch-all row', () => {
		// Untrimmed, the leading space would break the `^` anchor and the row
		// would wrongly read as a named measure instead of the guaranteed 100 g
		// catch-all.
		expect(pickDefaultServing([{ label: ' 100 g', grams: 100 }])).toBeNull();
	});

	it('trims a whole-item label before matching it', () => {
		// Untrimmed, the leading space would break the `^` anchor and the whole
		// item would lose to the first-named-measure fallback instead of
		// winning on its own merit.
		expect(
			pickDefaultServing([
				{ label: ' 1 sandwich', grams: 200 },
				{ label: '2 Tbsp', grams: 30 }
			])
		).toEqual({ label: ' 1 sandwich', grams: 200 });
	});

	it('trims a whole-item label even when it is not the first named measure', () => {
		// The previous case leaves the whole-item row first, so an untrimmed
		// match failure would still fall through to the same row via
		// `named[0]` and never be caught. Putting it second forces a real
		// difference: without `.trim()` the leading space breaks the `^`
		// anchor, `find` comes up empty, and the answer would wrongly be the
		// first plain measure instead.
		expect(
			pickDefaultServing([
				{ label: '2 Tbsp', grams: 30 },
				{ label: ' 1 sandwich', grams: 200 }
			])
		).toEqual({ label: ' 1 sandwich', grams: 200 });
	});

	it('does not treat a label that merely contains a weight as the catch-all row', () => {
		// PLAIN_GRAMS is anchored at both ends: a label carrying more than a bare
		// weight is a real, if odd, household measure and must survive the
		// catch-all filter.
		expect(pickDefaultServing([{ label: 'not 100 g', grams: 50 }])).toEqual({
			label: 'not 100 g',
			grams: 50
		});
		expect(pickDefaultServing([{ label: '100 g net', grams: 50 }])).toEqual({
			label: '100 g net',
			grams: 50
		});
	});

	it('recognizes a fractional gram weight as the catch-all row', () => {
		expect(pickDefaultServing([{ label: '100.25 g', grams: 100.25 }])).toBeNull();
	});

	it('recognizes a spaceless gram weight as the catch-all row', () => {
		expect(pickDefaultServing([{ label: '100g', grams: 100 }])).toBeNull();
	});

	it('never reaches for a whole-item measure named only as part of a longer label', () => {
		// WHOLE_ITEM is anchored at the start: a label that merely contains
		// "1 sandwich" further in must not out-rank the first named measure.
		expect(
			pickDefaultServing([
				{ label: '3 Tbsp', grams: 30 },
				{ label: 'xyz 1 sandwich', grams: 40 }
			])
		).toEqual({ label: '3 Tbsp', grams: 30 });
	});

	it('recognizes "1.00 item", not only "1.0 item", as a whole-item measure', () => {
		expect(
			pickDefaultServing([
				{ label: '2 Tbsp', grams: 30 },
				{ label: '1.00 item', grams: 150 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '1.00 item', grams: 150 });
	});

	it('recognizes a whole-item label with more than one space before the unit', () => {
		expect(
			pickDefaultServing([
				{ label: '2 Tbsp', grams: 30 },
				{ label: '1  sandwich', grams: 200 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '1  sandwich', grams: 200 });
	});

	it('picks the whole-item measure over an earlier plain named measure, regardless of array order', () => {
		expect(
			pickDefaultServing([
				{ label: '2 Tbsp', grams: 30 },
				{ label: '1 sandwich', grams: 200 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '1 sandwich', grams: 200 });
	});
});

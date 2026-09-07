import { describe, expect, it } from 'vitest';
import { formatUnitCount, isUnitMeasure, pickUnitMeasure, unitNoun } from './unit-measure';

describe('unitNoun / isUnitMeasure', () => {
	it('accepts a genuine single-item measure: Big Mac’s "1.0 item 7.6 oz"', () => {
		expect(unitNoun('1.0 item 7.6 oz')).toBe('item');
		expect(isUnitMeasure({ label: '1.0 item 7.6 oz', grams: 219 })).toBe(true);
	});

	it('accepts a real "1 Piece" measure', () => {
		expect(unitNoun('1 Piece')).toBe('piece');
		expect(isUnitMeasure({ label: '1 Piece', grams: 105 })).toBe(true);
	});

	it('rejects the popcorn-chicken trap: a count greater than one', () => {
		expect(unitNoun('13 PIECE')).toBeNull();
		expect(isUnitMeasure({ label: '13 PIECE', grams: 100 })).toBe(false);
		expect(unitNoun('4 PIECE')).toBeNull();
		expect(isUnitMeasure({ label: '4 PIECE', grams: 91 })).toBe(false);
	});

	it('rejects a bare mass or volume restated as if it were a unit', () => {
		for (const label of ['100 g', '1 cup', '250 ml', '1 ONZ']) {
			expect(unitNoun(label)).toBeNull();
			expect(isUnitMeasure({ label, grams: 100 })).toBe(false);
		}
	});

	it('rejects a row with no usable weight', () => {
		expect(isUnitMeasure({ label: '1 sandwich', grams: 0 })).toBe(false);
		expect(isUnitMeasure({ label: '1 sandwich', grams: Number.NaN })).toBe(false);
	});

	it('trims the label before matching', () => {
		expect(unitNoun('  1 sandwich  ')).toBe('sandwich');
	});

	it('recognizes every countable noun the ETL writes', () => {
		for (const noun of [
			'item',
			'piece',
			'sandwich',
			'cookie',
			'slice',
			'bar',
			'each',
			'burger',
			'can',
			'bottle',
			'container'
		]) {
			expect(unitNoun(`1 ${noun}`)).toBe(noun);
		}
	});

	it('is case-insensitive on both the count and the noun', () => {
		expect(unitNoun('1 PIECE')).toBe('piece');
	});

	it('never reaches for a noun named only later in a longer label', () => {
		expect(unitNoun('a can of 1 sandwich per box')).toBeNull();
	});

	it('rejects a count that merely starts with the digit 1, such as 10 or 12', () => {
		expect(unitNoun('10 piece')).toBeNull();
		expect(unitNoun('12 piece')).toBeNull();
	});

	it('accepts "1.00 item", not only "1.0 item"', () => {
		expect(unitNoun('1.00 item')).toBe('item');
	});

	it('accepts more than one space before the noun', () => {
		expect(unitNoun('1  sandwich')).toBe('sandwich');
	});
});

describe('pickUnitMeasure', () => {
	it('picks the first row that names a usable unit', () => {
		expect(
			pickUnitMeasure([
				{ label: '2 Tbsp', grams: 30 },
				{ label: '1.0 item 7.6 oz', grams: 219 },
				{ label: '100 g', grams: 100 }
			])
		).toEqual({ label: '1.0 item 7.6 oz', grams: 219 });
	});

	it('skips the popcorn-chicken trap even when it comes first', () => {
		expect(
			pickUnitMeasure([
				{ label: '13 PIECE', grams: 100 },
				{ label: '1 Piece', grams: 105 }
			])
		).toEqual({ label: '1 Piece', grams: 105 });
	});

	it('answers null when no row names a usable unit', () => {
		expect(
			pickUnitMeasure([
				{ label: '100 g', grams: 100 },
				{ label: '1 cup', grams: 240 },
				{ label: '13 PIECE', grams: 100 }
			])
		).toBeNull();
	});

	it('answers null for an empty list', () => {
		expect(pickUnitMeasure([])).toBeNull();
	});
});

describe('formatUnitCount', () => {
	it('formats a whole count in the singular', () => {
		expect(formatUnitCount(1, '1 Piece')).toBe('1 piece');
	});

	it('formats more than one in the plural', () => {
		expect(formatUnitCount(2, '1 Piece')).toBe('2 pieces');
	});

	it('pluralizes a noun ending in "ch" with "es"', () => {
		expect(formatUnitCount(2, '1 sandwich')).toBe('2 sandwiches');
	});

	it('does not pluralize "each"', () => {
		expect(formatUnitCount(3, '1 each')).toBe('3 each');
	});

	it('drops a trailing decimal zero', () => {
		expect(formatUnitCount(1.5, '1 Piece')).toBe('1.5 pieces');
		expect(formatUnitCount(2.0, '1 Piece')).toBe('2 pieces');
	});

	it('leaves a zero that is not trailing untouched', () => {
		// Guards the regex being anchored: an unanchored `/0/` would strip the
		// middle zero of "1.05" too and answer "1.5 pieces" instead.
		expect(formatUnitCount(1.05, '1 Piece')).toBe('1.05 pieces');
	});

	it('answers null when the label names no usable unit', () => {
		expect(formatUnitCount(2, '100 g')).toBeNull();
		expect(formatUnitCount(2, '1 cup')).toBeNull();
	});

	it('pluralizes every countable noun the ETL writes', () => {
		const expected: Record<string, string> = {
			item: 'items',
			piece: 'pieces',
			sandwich: 'sandwiches',
			cookie: 'cookies',
			slice: 'slices',
			bar: 'bars',
			each: 'each',
			burger: 'burgers',
			can: 'cans',
			bottle: 'bottles',
			container: 'containers'
		};
		for (const [noun, plural] of Object.entries(expected)) {
			expect(formatUnitCount(2, `1 ${noun}`)).toBe(`2 ${plural}`);
			expect(formatUnitCount(1, `1 ${noun}`)).toBe(`1 ${noun}`);
		}
	});
});

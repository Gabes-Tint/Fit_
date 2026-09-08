import { describe, expect, it } from 'vitest';
import {
	EIGHTH,
	amountFromGrams,
	amountGrams,
	massInUnits,
	massToGrams,
	parseAmount,
	roundAmount,
	stepAmount
} from './serving-amount';

/** A Big Mac as the catalog gives it: one sandwich, 219 g. */
const BIG_MAC = { servingLabel: '1 sandwich', grams: 219 };

/** A food whose weight is only ever stated by its own label (#74). */
const LABELLED = { servingLabel: '28 g' };

/** A food nothing knows the weight of: a volume, with no portion row behind it. */
const CUP = { servingLabel: '1 cup' };

describe('roundAmount', () => {
	it('keeps an eighth exact, which is what makes one survive a round trip', () => {
		expect(roundAmount(0.125)).toBe(0.125);
		expect(roundAmount(0.375)).toBe(0.375);
		expect(roundAmount(0.875)).toBe(0.875);
	});

	it('drops the noise floating-point arithmetic leaves behind', () => {
		expect(roundAmount(0.1 + 0.2)).toBe(0.3);
	});

	it('rounds a third to the thousandth the grid holds', () => {
		expect(roundAmount(1 / 3)).toBe(0.333);
	});
});

describe('stepAmount', () => {
	it('moves by half a serving, which is what one tap is', () => {
		expect(stepAmount(1, 0.5)).toBe(1.5);
		expect(stepAmount(1.5, 0.5)).toBe(2);
	});

	it('moves back down by the same half', () => {
		expect(stepAmount(2, -0.5)).toBe(1.5);
	});

	it('moves by a quarter for someone stepping in quarters', () => {
		expect(stepAmount(1, -0.25)).toBe(0.75);
	});

	it('carries a typed eighth through a half step rather than rounding it away', () => {
		expect(stepAmount(0.125, 0.5)).toBe(0.625);
		expect(stepAmount(0.625, 0.5)).toBe(1.125);
	});

	it('stops at an eighth rather than stepping down to nothing', () => {
		expect(stepAmount(0.5, -0.5)).toBe(EIGHTH);
		expect(stepAmount(0.125, -0.5)).toBe(EIGHTH);
	});

	it('does not floor an amount that is still above an eighth', () => {
		expect(stepAmount(1, -0.5)).toBe(0.5);
	});
});

describe('parseAmount', () => {
	it('reads a decimal', () => {
		expect(parseAmount('1.5')).toBe(1.5);
		expect(parseAmount('0.125')).toBe(0.125);
	});

	it('reads a fraction, which is how a person writes an eighth', () => {
		expect(parseAmount('1/8')).toBe(0.125);
		expect(parseAmount('3/4')).toBe(0.75);
	});

	it('reads a whole number in front of a fraction', () => {
		expect(parseAmount('1 1/2')).toBe(1.5);
	});

	it('reads a fraction that was typed with spaces around it', () => {
		expect(parseAmount(' 1/2 ')).toBe(0.5);
	});

	it('rounds a fraction the grid cannot hold to the thousandth', () => {
		expect(parseAmount('1/3')).toBe(0.333);
	});

	it('refuses text that names no amount', () => {
		expect(parseAmount('')).toBeNull();
		expect(parseAmount('   ')).toBeNull();
		expect(parseAmount('two')).toBeNull();
	});

	it('refuses an amount that would log nothing', () => {
		expect(parseAmount('0')).toBeNull();
		expect(parseAmount('-1')).toBeNull();
		expect(parseAmount('0/2')).toBeNull();
	});

	it('refuses an amount with no end to it', () => {
		expect(parseAmount('1/0')).toBeNull();
		expect(parseAmount('1e999')).toBeNull();
	});
});

describe('amountGrams', () => {
	it('weighs the servings against the food’s own serving weight', () => {
		expect(amountGrams(BIG_MAC, 2)).toBe(438);
		expect(amountGrams(BIG_MAC, 1)).toBe(219);
	});

	it('weighs a half and an eighth of a serving', () => {
		expect(amountGrams(BIG_MAC, 0.5)).toBe(109.5);
		expect(amountGrams(BIG_MAC, 0.125)).toBe(27.375);
	});

	it('falls back to the weight the label itself states (#74)', () => {
		expect(amountGrams(LABELLED, 2)).toBe(56);
	});

	it('says nothing for a food nothing knows the weight of', () => {
		expect(amountGrams(CUP, 2)).toBeNull();
	});
});

describe('amountFromGrams', () => {
	it('reads a typed weight back as servings', () => {
		expect(amountFromGrams(BIG_MAC, 438)).toBe(2);
		expect(amountFromGrams(BIG_MAC, 109.5)).toBe(0.5);
	});

	it('says nothing for a food with no serving weight to divide by', () => {
		expect(amountFromGrams(CUP, 100)).toBeNull();
	});

	it('says nothing for a weight that would log nothing', () => {
		expect(amountFromGrams(BIG_MAC, 0)).toBeNull();
	});
});

describe('switching to grams and back', () => {
	it('gives back the amount that went in, halves and eighths included', () => {
		for (const servings of [0.125, 0.5, 1, 1.5, 2, 2.625]) {
			const grams = amountGrams(BIG_MAC, servings);
			expect(grams).not.toBeNull();
			expect(amountFromGrams(BIG_MAC, Number(grams))).toBe(servings);
		}
	});
});

describe('the weight the field itself shows', () => {
	it('reads whole grams in metric', () => {
		expect(massInUnits(328.5, 'metric')).toBe(329);
		expect(massInUnits(219, 'metric')).toBe(219);
	});

	it('reads the one decimal an ounce is read at in imperial (#71, #74)', () => {
		expect(massInUnits(219, 'imperial')).toBe(7.7);
		expect(massInUnits(28, 'imperial')).toBe(1);
	});

	it('takes a typed weight in the system it was typed in', () => {
		expect(massToGrams(438, 'metric')).toBe(438);
		expect(massToGrams(16, 'imperial')).toBeCloseTo(453.592, 3);
	});
});

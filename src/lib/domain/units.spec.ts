import { describe, expect, it } from 'vitest';
import {
	cmToIn,
	displayWeight,
	formatServingMass,
	formatWeight,
	gToOz,
	heightFromFeetInches,
	heightToFeetInches,
	inToCm,
	kgToLb,
	lbToKg,
	ozToG,
	weightToKg,
	weightUnitAbbr,
	weightUnitName
} from './units';

describe('weight conversion', () => {
	it('reads 74.3 kg as 163.8 lb, not the raw floating result', () => {
		expect(displayWeight(74.3, 'imperial')).toBe(163.8);
		expect(kgToLb(74.3)).not.toBe(163.8); // the raw value carries more decimals
	});

	it('reads a metric weight to one decimal too', () => {
		expect(displayWeight(74.3, 'metric')).toBe(74.3);
		expect(displayWeight(78, 'metric')).toBe(78);
	});

	it('round-trips kg -> lb -> kg with no drift', () => {
		for (const kg of [0, 1, 45.359237, 74.3, 100, 163.8]) {
			expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
		}
	});

	it('round-trips lb -> kg -> lb with no drift', () => {
		for (const lb of [0, 1, 100, 163.8, 220.5]) {
			expect(kgToLb(lbToKg(lb))).toBeCloseTo(lb, 9);
		}
	});

	it('switching metric -> imperial -> metric returns the original reading', () => {
		const kg = 74.3;
		const asImperial = displayWeight(kg, 'imperial');
		const roundTripped = weightToKg(asImperial, 'imperial');
		expect(displayWeight(roundTripped, 'metric')).toBeCloseTo(kg, 1);
	});

	it('converts a typed reading back to canonical kg', () => {
		expect(weightToKg(163.8, 'imperial')).toBeCloseTo(74.3, 1);
		expect(weightToKg(74.3, 'metric')).toBe(74.3);
	});

	it('names the unit in full for a screen reader, not just the abbreviation', () => {
		expect(weightUnitName('imperial')).toBe('pounds');
		expect(weightUnitName('metric')).toBe('kilograms');
		expect(weightUnitAbbr('imperial')).toBe('lb');
		expect(weightUnitAbbr('metric')).toBe('kg');
	});

	it('keeps a whole reading from dropping its decimal in text', () => {
		expect(formatWeight(74, 'metric')).toBe('74.0');
		expect(formatWeight(80, 'imperial')).toBe('176.4');
	});
});

describe('height conversion', () => {
	it('reads a height as feet and inches', () => {
		// 168 cm is 5'6.1", which rounds to 5'6.
		expect(heightToFeetInches(168)).toEqual({ feet: 5, inches: 6 });
	});

	it('carries a foot when inches round up to twelve', () => {
		// 182.5 cm is 71.85 in, which rounds to 72 in = 6'0", not 5'12".
		expect(heightToFeetInches(182.5)).toEqual({ feet: 6, inches: 0 });
	});

	it('round-trips cm -> in -> cm with no drift', () => {
		for (const cm of [0, 100, 152.4, 168, 190.5]) {
			expect(inToCm(cmToIn(cm))).toBeCloseTo(cm, 9);
		}
	});

	it('converts feet and inches typed in imperial back to canonical cm', () => {
		expect(heightFromFeetInches(5, 6)).toBeCloseTo(167.64, 2);
	});

	it('round-trips feet and inches typed in, back out, with no drift', () => {
		expect(heightToFeetInches(heightFromFeetInches(5, 9))).toEqual({ feet: 5, inches: 9 });
	});
});

describe('serving mass (#74)', () => {
	it('reads grams as ounces by the same pound the weights use', () => {
		expect(gToOz(453.59237)).toBeCloseTo(16, 9);
		expect(ozToG(16)).toBeCloseTo(453.59237, 9);
	});

	it('round-trips g -> oz -> g with no drift', () => {
		for (const grams of [1, 28.349523125, 50, 100, 244, 1000]) {
			expect(ozToG(gToOz(grams))).toBeCloseTo(grams, 9);
		}
	});

	it('prints a portion in whole grams for metric', () => {
		expect(formatServingMass(244, 'metric')).toBe('244 g');
		expect(formatServingMass(244.4, 'metric')).toBe('244 g');
		expect(formatServingMass(0.4, 'metric')).toBe('0 g');
	});

	it('prints a portion to a tenth of an ounce for imperial', () => {
		expect(formatServingMass(244, 'imperial')).toBe('8.6 oz');
		expect(formatServingMass(100, 'imperial')).toBe('3.5 oz');
	});

	it('drops a trailing zero a portion does not need', () => {
		expect(formatServingMass(453.59237, 'imperial')).toBe('16 oz');
	});
});

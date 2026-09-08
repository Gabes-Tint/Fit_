import { describe, expect, it } from 'vitest';
import {
	describePortion,
	servingMassGrams,
	statedMass,
	type PortionSource
} from './serving-display';
import type { UnitSystem } from './types';

/** A cup of 2% milk, the catalog's own numbers: a volume label with a real mass. */
const MILK = { servingLabel: '1 cup', grams: 244 };
/** A large egg: a countable label that names no unit at all. */
const EGG = { servingLabel: '1 large', grams: 50 };

describe('statedMass', () => {
	it('reads a mass a label states on its own', () => {
		expect(statedMass('100 g')).toEqual({ grams: 100, system: 'metric' });
	});

	it('reads one stated inside a trailing parenthetical', () => {
		expect(statedMass('1 scoop (30 g)')).toEqual({ grams: 30, system: 'metric' });
	});

	it('reads one stated in the middle of the label', () => {
		expect(statedMass('170 g cup')).toEqual({ grams: 170, system: 'metric' });
	});

	it('reads an imperial mass as imperial, converted to grams', () => {
		const read = statedMass('1 oz (23 nuts)');
		expect(read?.system).toBe('imperial');
		expect(read?.grams).toBeCloseTo(28.349523125, 9);
	});

	it('refuses a volume: millilitres are not a mass', () => {
		expect(statedMass('1 bottle (414 ml)')).toBeNull();
		expect(statedMass('1 cup')).toBeNull();
		expect(statedMass('1/2 cup dry')).toBeNull();
	});

	it('refuses a label that names no measurement', () => {
		expect(statedMass('1 large')).toBeNull();
		expect(statedMass('1 bowl (chicken, rice, beans, salsa, lettuce)')).toBeNull();
	});

	it('needs a count in front of the unit', () => {
		// "bar" is not a unit and nothing counts the "g" of "gluten", so this
		// label states no mass at all rather than one gram of something.
		expect(statedMass('1 bar, gluten free')).toBeNull();
	});

	it('reads a decimal mass to every digit the source wrote', () => {
		// Open Food Facts writes a serving size like this, and reading it as
		// "28.3 g" or dropping it entirely both lose the number the source gave.
		expect(statedMass('28.35 g')?.grams).toBeCloseTo(28.35, 6);
	});

	it('reads a mass a source wrote with no space in front of its unit', () => {
		expect(statedMass('1 bar (30g)')).toEqual({ grams: 30, system: 'metric' });
	});

	it('reads kilograms and pounds, each as its own system', () => {
		expect(statedMass('1 kg')).toEqual({ grams: 1000, system: 'metric' });
		const pound = statedMass('1 lb');
		expect(pound?.system).toBe('imperial');
		expect(pound?.grams).toBeCloseTo(453.59237, 6);
	});

	it('refuses a fraction rather than reading the wrong half of it', () => {
		// "1/2 lb" is half a pound. Reading the "2" would log four times the
		// food, so a label the pattern cannot parse states no mass at all.
		expect(statedMass('1/2 lb patty')).toBeNull();
	});

	it('refuses a mass of zero, which nothing can be scaled by', () => {
		expect(statedMass('0 g')).toBeNull();
	});
});

describe('servingMassGrams', () => {
	it('prefers the food’s own serving weight', () => {
		expect(servingMassGrams({ servingLabel: '1 cup', grams: 244 })).toBe(244);
	});

	it('falls back to the mass the label states when the holder kept no weight', () => {
		expect(servingMassGrams({ servingLabel: '1 scoop (30 g)' })).toBe(30);
	});

	it('answers null when neither the holder nor the label says', () => {
		expect(servingMassGrams({ servingLabel: '1 cup' })).toBeNull();
	});

	it('ignores a weight that cannot be divided or scaled', () => {
		expect(servingMassGrams({ servingLabel: '1 cup', grams: 0 })).toBeNull();
		expect(servingMassGrams({ servingLabel: '1 cup', grams: Number.NaN })).toBeNull();
		expect(servingMassGrams({ servingLabel: '1 cup', grams: -5 })).toBeNull();
		expect(servingMassGrams({ servingLabel: '1 cup', grams: Number.POSITIVE_INFINITY })).toBeNull();
	});
});

/** The mass a portion phrase appended, as a number, or `null` when it appended none. */
function mass(text: string): number | null {
	const appended = text.split(' · ')[1];
	return appended === undefined ? null : Number.parseFloat(appended);
}

/**
 * The phrase ends in the mass `grams` comes to in `units`, printed at the
 * precision that system is read at: a whole gram, or a tenth of an ounce.
 */
function expectMass(phrase: string, grams: number, units: UnitSystem): void {
	const printed = mass(phrase);
	expect(printed).not.toBeNull();
	const truth = units === 'imperial' ? grams / 28.349523125 : grams;
	expect(Math.abs(Number(printed) - truth)).toBeLessThanOrEqual(units === 'imperial' ? 0.05 : 0.5);
}

describe('describePortion', () => {
	it('shows a metric label alone to someone reading in metric', () => {
		expect(describePortion({ servingLabel: '100 g', grams: 100 }, 1, 'metric')).toBe('100 g');
	});

	it('appends grams when the label states its mass in imperial', () => {
		expect(describePortion({ servingLabel: '1 oz' }, 1, 'metric')).toBe('1 oz · 28 g');
	});

	it('appends ounces when the label states its mass in metric', () => {
		expect(describePortion({ servingLabel: '100 g', grams: 100 }, 1, 'imperial')).toBe(
			'100 g · 3.5 oz'
		);
	});

	it('never states the same mass twice, wherever the label puts it', () => {
		expect(describePortion({ servingLabel: '1 scoop (30 g)', grams: 30 }, 1, 'metric')).toBe(
			'1 scoop (30 g)'
		);
		expect(describePortion({ servingLabel: '170 g cup', grams: 170 }, 1, 'metric')).toBe(
			'170 g cup'
		);
	});

	it('still converts a label that states grams in the middle for an imperial reader', () => {
		expect(describePortion({ servingLabel: '170 g cup', grams: 170 }, 1, 'imperial')).toBe(
			'170 g cup · 6 oz'
		);
	});

	it('gives a countable label a magnitude it otherwise has none of', () => {
		expect(describePortion(EGG, 1, 'metric')).toBe('1 large · 50 g');
		expect(describePortion(EGG, 1, 'imperial')).toBe('1 large · 1.8 oz');
	});

	it('keeps the millilitre hint and adds the food’s own mass beside it', () => {
		expect(describePortion(MILK, 1, 'metric')).toBe('1 cup (240 ml) · 244 g');
		expect(describePortion(MILK, 1, 'imperial')).toBe('1 cup (240 ml) · 8.6 oz');
	});

	it('leads with the count and closes with the scaled mass, writing the label once', () => {
		expect(describePortion(MILK, 2, 'metric')).toBe('2 × 1 cup (240 ml) · 488 g');
		expect(describePortion(MILK, 2, 'imperial')).toBe('2 × 1 cup (240 ml) · 17.2 oz');
	});

	it('shows the label alone when nothing knows what the serving weighs', () => {
		expect(describePortion({ servingLabel: '1 cup' }, 2, 'metric')).toBe('2 × 1 cup (240 ml)');
		expect(describePortion({ servingLabel: '1 large' }, 3, 'imperial')).toBe('3 × 1 large');
	});

	it('trims a count rather than printing every digit of it', () => {
		expect(describePortion(EGG, 2.26796185, 'metric')).toBe('2.27 × 1 large · 113 g');
	});

	/**
	 * The acceptance criterion #74 states outright: whatever two servings reads
	 * as has to be consistent with what one serving reads as. Asserted over
	 * every label shape rather than on one example, because the render sites
	 * each pass a different serving count.
	 */
	const SHAPES = [
		{ source: MILK, units: 'metric' },
		{ source: MILK, units: 'imperial' },
		{ source: EGG, units: 'metric' },
		{ source: EGG, units: 'imperial' },
		{ source: { servingLabel: '100 g', grams: 100 }, units: 'metric' },
		{ source: { servingLabel: '100 g', grams: 100 }, units: 'imperial' },
		{ source: { servingLabel: '1 oz (23 nuts)' }, units: 'metric' },
		{ source: { servingLabel: '1 oz (23 nuts)' }, units: 'imperial' },
		{ source: { servingLabel: '1 scoop (30 g)', grams: 30 }, units: 'imperial' },
		{ source: { servingLabel: '1 cup' }, units: 'metric' },
		{ source: { servingLabel: '1 large' }, units: 'imperial' }
	] as const satisfies readonly { source: PortionSource; units: UnitSystem }[];

	it('reads two servings as the same portion, at twice the mass', () => {
		// Every shape whose label leaves a mass to append. Each reading is the
		// true mass for its own count, rounded once: 50 g reads 1.8 oz and 100 g
		// reads 3.5 oz, and both are right — it is 1.8 doubled that is wrong,
		// not the display.
		const scaled = SHAPES.filter(
			({ source, units }) => mass(describePortion(source, 1, units)) !== null
		);
		expect(scaled).not.toHaveLength(0);
		for (const { source, units } of scaled) {
			const grams = Number(servingMassGrams(source));
			expectMass(describePortion(source, 1, units), grams, units);
			expectMass(describePortion(source, 2, units), grams * 2, units);
		}
	});

	it('appends nothing to two servings when it appended nothing to one', () => {
		// A label already reading in this system appends nothing, and a serving
		// nothing knows the weight of has nothing to append: a count of two must
		// not conjure a mass that one serving did not show.
		const plain = SHAPES.filter(
			({ source, units }) => mass(describePortion(source, 1, units)) === null
		);
		expect(plain).not.toHaveLength(0);
		for (const { source, units } of plain) {
			expect(mass(describePortion(source, 2, units))).toBeNull();
		}
	});

	it('writes the label once whatever the count, and leads with the count', () => {
		for (const { source, units } of SHAPES) {
			const one = describePortion(source, 1, units);
			const two = describePortion(source, 2, units);
			expect(two.split(source.servingLabel)).toHaveLength(2);
			expect(two.startsWith(`2 × ${source.servingLabel}`)).toBe(true);
			expect(one.startsWith(source.servingLabel)).toBe(true);
		}
	});
});

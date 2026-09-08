import { describe, expect, it } from 'vitest';
import { wholePackGrams } from './whole-pack';

/** A bag of chips as the catalog gives one: a 28 g label serving, 155 g in the bag. */
const CHIPS = {
	servingLabel: '1 oz',
	grams: 28,
	servingOptions: [
		{ label: '1 oz', grams: 28 },
		{ label: '1 bag', grams: 155 },
		{ label: '100 g', grams: 100 }
	]
};

describe('wholePackGrams', () => {
	it('finds the package mass the source named', () => {
		expect(wholePackGrams(CHIPS)).toBe(155);
	});

	it('reads the package noun through the spellings the ETL writes', () => {
		for (const label of ['1 package', '1.0 container', '1 BOTTLE', ' 1 bag', '1 pouch']) {
			expect(
				wholePackGrams({ servingLabel: '1 oz', grams: 28, servingOptions: [{ label, grams: 155 }] })
			).toBe(155);
		}
	});

	it('says nothing when the food named no serving choices at all', () => {
		expect(wholePackGrams({ servingLabel: '1 oz', grams: 28 })).toBeNull();
	});

	it('says nothing when none of the choices names a package', () => {
		expect(
			wholePackGrams({
				servingLabel: '1 oz',
				grams: 28,
				servingOptions: [
					{ label: '100 g', grams: 100 },
					{ label: '1 cup', grams: 40 }
				]
			})
		).toBeNull();
	});

	it('refuses a count that is not one, which would log the weight of several', () => {
		expect(
			wholePackGrams({
				servingLabel: '1 oz',
				grams: 28,
				servingOptions: [{ label: '6 bags', grams: 930 }]
			})
		).toBeNull();
	});

	it('refuses a noun that only starts like a package one', () => {
		expect(
			wholePackGrams({
				servingLabel: '1 oz',
				grams: 28,
				servingOptions: [{ label: '1 bagel', grams: 100 }]
			})
		).toBeNull();
	});

	it('refuses a package the source gave no usable weight for', () => {
		for (const grams of [0, -155, Number.POSITIVE_INFINITY]) {
			expect(
				wholePackGrams({
					servingLabel: '1 oz',
					grams: 28,
					servingOptions: [{ label: '1 bag', grams }]
				})
			).toBeNull();
		}
	});

	it('says nothing when the whole pack is the serving, so the choice would change nothing', () => {
		expect(
			wholePackGrams({
				servingLabel: '1 bag',
				grams: 28,
				servingOptions: [{ label: '1 bag', grams: 28 }]
			})
		).toBeNull();
	});

	it('weighs the pack against the weight the label states when the food carries none (#74)', () => {
		expect(
			wholePackGrams({
				servingLabel: '28 g',
				servingOptions: [{ label: '1 bag', grams: 28 }]
			})
		).toBeNull();
	});
});

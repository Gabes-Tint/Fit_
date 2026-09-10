import { describe, expect, it } from 'vitest';
import { migrate_4_to_5 } from './migrate-left-handed';

/** A version-4 document, before the preference existed. */
const V4 = {
	schemaVersion: 4,
	onboarded: true,
	units: 'imperial'
};

describe('a document that came up from version 4', () => {
	it('gets the off default, because version 4 had no opinion either way', () => {
		expect(migrate_4_to_5(V4)['leftHanded']).toBe(false);
	});

	it('preserves an existing true value rather than overwriting it', () => {
		const v4WithLeftHanded = { ...V4, leftHanded: true };

		expect(migrate_4_to_5(v4WithLeftHanded)['leftHanded']).toBe(true);
	});

	it('preserves an existing false value the same way', () => {
		const v4WithLeftHanded = { ...V4, leftHanded: false };

		expect(migrate_4_to_5(v4WithLeftHanded)['leftHanded']).toBe(false);
	});

	// A document taken from another device (`replace()`) can carry a value that
	// is not a boolean at all before this rung has ever run on it — the field
	// simply is not one this build recognises yet. That is treated the same as
	// an absent field: the off default, not the stray value carried through.
	it('falls back to the off default when the field is present but not a boolean', () => {
		const v4WithBadField = { ...V4, leftHanded: 'yes' };

		expect(migrate_4_to_5(v4WithBadField)['leftHanded']).toBe(false);
	});
});

describe('what the rung leaves alone', () => {
	it('touches nothing outside the new field', () => {
		const upgraded = migrate_4_to_5(V4);

		expect(upgraded['onboarded']).toBe(true);
		expect(upgraded['units']).toBe('imperial');
	});
});

describe('the rung itself', () => {
	it('stamps the version it upgraded to', () => {
		expect(migrate_4_to_5(V4)['schemaVersion']).toBe(5);
	});

	it('runs pure: the document it was handed is not touched', () => {
		const before = JSON.stringify(V4);

		migrate_4_to_5(V4);

		expect(JSON.stringify(V4)).toBe(before);
	});

	it('runs idempotent: applied to its own output it changes nothing further', () => {
		const once = migrate_4_to_5(V4);

		expect(migrate_4_to_5(once)).toEqual(once);
	});

	// The one rung allowed to be a true no-op: read the exact document back,
	// not merely one that is equal to it, so a mutant that swaps the early
	// return for `false` (always rebuilding the object) cannot pass by
	// producing something that happens to look the same.
	it('hands back the identical object when the version already matches, and rebuilds nothing', () => {
		const atCurrent = { schemaVersion: 5, leftHanded: true };

		expect(migrate_4_to_5(atCurrent)).toBe(atCurrent);
	});
});

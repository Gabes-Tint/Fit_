import { describe, expect, it } from 'vitest';
import { migrate_2_to_3 } from './migrate-deleted-routines';

/** A version-2 document: two routines, days planned for both, and no deletion flag anywhere. */
const V2 = {
	schemaVersion: 2,
	routines: [
		{ id: 'push', name: 'Push', exercises: [] },
		{ id: 'legs', name: 'Legs', exercises: [] }
	],
	trainingPlan: [
		{ date: '2026-01-05', routineIds: ['push'] },
		{ date: '2026-01-07', routineIds: ['push', 'legs'] }
	],
	pantry: ['oats']
};

type RoutineV3 = { id: string; name: string; deletedAt: string | null };

function routines(document: Record<string, unknown>): RoutineV3[] {
	return migrate_2_to_3(document)['routines'] as RoutineV3[];
}

describe('a routine that came up from version 2', () => {
	it('arrives in the rotation, because version 2 had no other way for it to be there', () => {
		expect(routines(V2).map((r) => r.deletedAt)).toEqual([null, null]);
	});

	it('keeps its id, its name and its movements', () => {
		expect(routines(V2).map((r) => r.id)).toEqual(['push', 'legs']);
		expect(routines(V2)[0]).toMatchObject({ name: 'Push', exercises: [] });
	});
});

describe('what the rung leaves alone', () => {
	it('touches nothing outside the routine list', () => {
		const upgraded = migrate_2_to_3(V2);

		expect(upgraded['trainingPlan']).toEqual(V2.trainingPlan);
		expect(upgraded['pantry']).toEqual(['oats']);
	});

	it('carries a document with no routines at all', () => {
		expect(migrate_2_to_3({})).toEqual({ schemaVersion: 3, routines: undefined });
	});

	it('leaves a routine list that is not one as it found it, for the shape check to refuse', () => {
		expect(migrate_2_to_3({ routines: 'none' })['routines']).toBe('none');
	});

	it('leaves a row that is not a routine as it found it', () => {
		expect(migrate_2_to_3({ routines: [null, 7, 'push'] })['routines']).toEqual([null, 7, 'push']);
	});
});

describe('the rung itself', () => {
	it('stamps the version it upgraded to', () => {
		expect(migrate_2_to_3(V2)['schemaVersion']).toBe(3);
	});

	it('runs pure: the document it was handed is not touched', () => {
		const before = JSON.stringify(V2);

		migrate_2_to_3(V2);

		expect(JSON.stringify(V2)).toBe(before);
	});

	it('runs idempotent: applied to its own output it changes nothing further', () => {
		const once = migrate_2_to_3(V2);

		expect(migrate_2_to_3(once)).toEqual(once);
	});
});

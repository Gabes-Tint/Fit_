import { describe, expect, it } from 'vitest';
import { REST_WEEK, type PlannedWeek } from '$lib/domain/types';
import { routine } from '$lib/testing/fixtures';
import { plannedOption, planOptions } from './plan-options';

const ROUTINES = [routine('push', 'Chest & Shoulders'), routine('legs', 'Legs', 2)];
const OPTIONS = planOptions(ROUTINES);
const PLAN: PlannedWeek[] = [{ year: 2026, week: 5, routineId: 'legs' }];

describe('planOptions', () => {
	it('offers every routine plus a rest week', () => {
		expect(OPTIONS.map((option) => option.id)).toEqual(['push', 'legs', REST_WEEK]);
	});

	it('names the rest week', () => {
		expect(planOptions([]).at(-1)?.name).toBe('Rest week');
	});

	it('carries the routine initial and the days its frequency lands on', () => {
		expect(OPTIONS[1]).toMatchObject({ letter: 'L', days: [0, 3] });
	});

	it('marks the rest week with a dash rather than an initial', () => {
		expect(OPTIONS.at(-1)?.letter).toBe('—');
	});

	it('leaves a rest week without training days', () => {
		expect(OPTIONS.at(-1)?.days).toEqual([]);
	});

	it('gives each routine its own tone', () => {
		expect(OPTIONS[0]?.tone.ink).not.toBe(OPTIONS[1]?.tone.ink);
	});
});

describe('plannedOption', () => {
	it('finds what a week was planned as', () => {
		expect(plannedOption(OPTIONS, PLAN, 2026, 5)?.name).toBe('Legs');
	});

	it('returns nothing for a week that was never assigned', () => {
		expect(plannedOption(OPTIONS, PLAN, 2026, 6)).toBeUndefined();
	});

	it('returns nothing for a week planned in a different year', () => {
		expect(plannedOption(OPTIONS, PLAN, 2025, 5)).toBeUndefined();
	});
});

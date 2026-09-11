import { describe, expect, it } from 'vitest';
import { exerciseLabel } from './exercise-label';

describe('exercise label formatting', () => {
	it('produces the exact label <exercise name> · <count> reps', () => {
		expect(exerciseLabel('Squat', 10)).toBe('Squat · 10 reps');
	});

	it('trims surrounding whitespace from the exercise name', () => {
		expect(exerciseLabel('  Bench Press  ', 8)).toBe('Bench Press · 8 reps');
	});

	it('rejects an empty name', () => {
		expect(() => exerciseLabel('', 10)).toThrow();
	});

	it('rejects a repetition count below 1', () => {
		expect(() => exerciseLabel('Squat', 0)).toThrow();
		expect(() => exerciseLabel('Squat', -1)).toThrow();
	});
});

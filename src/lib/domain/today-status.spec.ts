import { describe, expect, it } from 'vitest';
import { trainingWeekText } from './today-status';

describe('trainingWeekText', () => {
	it('states plainly when nothing was logged or planned', () => {
		expect(trainingWeekText({ planned: 0, done: 0 })).toBe(
			'No training logged or planned this week.'
		);
	});

	it('reports sessions done when the plan asked for nothing', () => {
		expect(trainingWeekText({ planned: 0, done: 2 })).toBe(
			'2 sessions this week. Nothing was planned.'
		);
	});

	it('singularizes one session against an empty plan', () => {
		expect(trainingWeekText({ planned: 0, done: 1 })).toBe(
			'1 session this week. Nothing was planned.'
		);
	});

	it('reports done against planned without judgement when short', () => {
		expect(trainingWeekText({ planned: 3, done: 1 })).toBe('1 of 3 sessions this week.');
	});

	it('reports done against planned when met', () => {
		expect(trainingWeekText({ planned: 3, done: 3 })).toBe('3 of 3 sessions this week.');
	});

	it('singularizes a plan of one', () => {
		expect(trainingWeekText({ planned: 1, done: 0 })).toBe('0 of 1 session this week.');
	});
});

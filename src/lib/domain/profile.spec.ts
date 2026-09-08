import { describe, expect, it } from 'vitest';
import { defaultServings, emptyProfile, isGlp1, servingStep } from './profile';

describe('emptyProfile', () => {
	it('starts with nothing logged', () => {
		const p = emptyProfile({ name: 'New' });
		expect(p.log).toEqual([]);
		expect(p.weights).toEqual([]);
	});

	it('starts with no injection recorded', () => {
		expect(emptyProfile({ name: 'New' }).injections).toEqual([]);
	});

	// Ids are read by hand in an exported document and in a sync payload, where
	// `p-` is what says which list a row belongs to.
	it('gives the id a prefix naming what it identifies', () => {
		expect(emptyProfile({ name: 'New' }).id).toMatch(/^p-/);
	});

	it('applies the given name', () => {
		expect(emptyProfile({ name: 'Sam' }).name).toBe('Sam');
	});

	it('gives each profile a distinct id', () => {
		expect(emptyProfile({ name: 'A' }).id).not.toBe(emptyProfile({ name: 'B' }).id);
	});

	it('leaves every target on automatic', () => {
		const p = emptyProfile({ name: 'New' });
		expect([p.calorieOverride, p.proteinOverride, p.fiberOverride]).toEqual([null, null, null]);
	});
});

describe('isGlp1', () => {
	it('is true when the switch is on', () => {
		expect(isGlp1({ glp1: true, goal: 'lose' })).toBe(true);
	});

	it('is true when the goal alone says so', () => {
		expect(isGlp1({ glp1: false, goal: 'glp1' })).toBe(true);
	});

	it('is false for an ordinary profile', () => {
		expect(isGlp1({ glp1: false, goal: 'maintain' })).toBe(false);
	});

	it('is false when there is no profile yet', () => {
		expect(isGlp1(null)).toBe(false);
	});
});

describe('portion sizes', () => {
	it('steps in quarters on GLP-1, where part-portions are routine', () => {
		expect(servingStep({ glp1: true, goal: 'lose' })).toBe(0.25);
	});

	it('steps in halves otherwise', () => {
		expect(servingStep({ glp1: false, goal: 'lose' })).toBe(0.5);
	});

	it('starts a proposal at half a serving on GLP-1', () => {
		expect(defaultServings({ glp1: true, goal: 'lose' })).toBe(0.5);
	});

	it('starts a proposal at a whole serving otherwise', () => {
		expect(defaultServings(null)).toBe(1);
	});
});

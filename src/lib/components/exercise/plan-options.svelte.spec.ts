import { describe, expect, it } from 'vitest';
import { routine } from '$lib/testing/fixtures';
import { optionsOn, planOptions } from './plan-options';

const ROUTINES = [routine('push', 'Chest & Shoulders'), routine('legs', 'Legs')];
const OPTIONS = planOptions(ROUTINES);

describe('planOptions', () => {
	it('offers the rotation and nothing else — rest is a day with nothing on it', () => {
		expect(OPTIONS.map((option) => option.id)).toEqual(['push', 'legs']);
		expect(planOptions([])).toEqual([]);
	});

	it('carries the routine name and its initial', () => {
		expect(OPTIONS[1]).toMatchObject({ name: 'Legs', letter: 'L' });
	});

	it('gives each routine its own tone', () => {
		expect(OPTIONS[0]?.tone.ink).not.toBe(OPTIONS[1]?.tone.ink);
	});
});

describe('optionsOn', () => {
	it('dresses a day’s routines in the order the day holds them', () => {
		expect(optionsOn(OPTIONS, ['legs', 'push']).map((option) => option.name)).toEqual([
			'Legs',
			'Chest & Shoulders'
		]);
	});

	it('shows the same routine twice when a day asks for it twice', () => {
		expect(optionsOn(OPTIONS, ['push', 'push'])).toHaveLength(2);
	});

	it('leaves out an id no routine answers to, rather than drawing a gap', () => {
		expect(optionsOn(OPTIONS, ['deleted', 'push']).map((option) => option.id)).toEqual(['push']);
	});

	it('has nothing to dress for a day with nothing on it', () => {
		expect(optionsOn(OPTIONS, [])).toEqual([]);
	});
});

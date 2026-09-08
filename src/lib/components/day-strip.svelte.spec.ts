import { describe, expect, it } from 'vitest';
import { DAY_STRIP_CELL } from './day-strip';

describe('DAY_STRIP_CELL', () => {
	it('sizes the cell to match the home strip pill', () => {
		expect(DAY_STRIP_CELL).toContain('h-16');
		expect(DAY_STRIP_CELL).toContain('w-20');
	});

	it('shapes the cell as a rounded rectangle, not a circle', () => {
		expect(DAY_STRIP_CELL).toContain('rounded-lg');
		expect(DAY_STRIP_CELL).not.toContain('rounded-full');
	});

	it('keeps the cell from shrinking or growing in the scroller', () => {
		expect(DAY_STRIP_CELL).toContain('shrink-0');
	});

	it('snaps the cell to center as the strip scrolls', () => {
		expect(DAY_STRIP_CELL).toContain('snap-center');
	});
});

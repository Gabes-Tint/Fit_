// A spec file of its own because it has to fix the process timezone before
// anything reads a `Date`, and it must not fix it for every other suite.
//
// `parseISODate` builds local-midnight `Date`s, so in a zone that observes
// daylight saving two midnights either side of a transition are 23 or 25 hours
// apart, not 24. `calmWeeks` turns a date into a week index by counting days
// from a fixed epoch Monday, and that hour is enough to push a date into the
// week beside it unless the day count is rounded first.
//
// The rest of `tdee.spec.ts` cannot catch this: every date in it is in June,
// one side of a transition, and CI runs UTC where no transition exists at all.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';
import { calmWeeks } from './tdee';
import { parseISODate } from './utils';
import type { LogItem } from './types';

/** Only the date is read, so the rest of a `LogItem` is not worth building. */
function day(date: string): LogItem {
	return { date } as LogItem;
}

describe('calmWeeks across a daylight-saving transition', () => {
	// If this fails the suite below proves nothing: it would be re-testing UTC,
	// where every day is exactly 24 hours and the rounding is a no-op.
	it('is actually running in a zone that observes daylight saving', () => {
		const winter = parseISODate('2026-01-15').getTimezoneOffset();
		const summer = parseISODate('2026-07-15').getTimezoneOffset();
		expect(summer).not.toBe(winter);
	});

	// 2026-03-08 is the spring-forward Sunday, so 2026-03-09 is the first Monday
	// on the far side of it — a week boundary whose local midnight sits an hour
	// off the epoch's. Without rounding it lands in the previous week, which
	// splits these four days across two weeks and neither one clears the bar.
	it('keeps a week whole when it begins the Monday after spring forward', () => {
		const log = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'].map(day);
		expect(calmWeeks(log, 4, '2026-03-15')).toBe(1);
	});

	// The same on the other side of the year: 2026-11-01 is the fall-back
	// Sunday, and it is the last day of the week that began 2026-10-26.
	it('keeps a week whole across the fall-back Sunday that ends it', () => {
		const log = ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-01'].map(day);
		expect(calmWeeks(log, 4, '2026-11-01')).toBe(1);
	});

	// A journal spanning both transitions: 34 Mondays in 2026 fall in the
	// daylight-saving half of the year, and every one of them is a week boundary
	// the rounding has to place correctly.
	it('counts every whole week of a journal spanning both transitions', () => {
		const log: LogItem[] = [];
		// Eight Mondays from the one after spring forward, each with the three
		// days following it, so every week has exactly four logged days.
		const mondays = [
			'2026-03-09',
			'2026-03-16',
			'2026-03-23',
			'2026-03-30',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26',
			'2026-11-02'
		];
		for (const monday of mondays) {
			const start = parseISODate(monday);
			for (let offset = 0; offset < 4; offset += 1) {
				const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
				const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
					d.getDate()
				).padStart(2, '0')}`;
				log.push(day(iso));
			}
		}
		expect(calmWeeks(log, 4, '2026-11-08')).toBe(mondays.length);
	});
});

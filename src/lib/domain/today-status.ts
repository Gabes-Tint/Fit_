import type { AdherenceWeek } from '$lib/domain/training-progress';

/**
 * How the current week's training reads on Today: sessions done against
 * whatever the plan asked for, stated once and left alone. A week the plan
 * left empty asks for nothing, so it is reported as sessions done, not a
 * shortfall against zero.
 */
export function trainingWeekText(week: Pick<AdherenceWeek, 'planned' | 'done'>): string {
	if (week.planned === 0 && week.done === 0) return 'No training logged or planned this week.';
	if (week.planned === 0) {
		return `${week.done} session${week.done === 1 ? '' : 's'} this week. Nothing was planned.`;
	}
	return `${week.done} of ${week.planned} session${week.planned === 1 ? '' : 's'} this week.`;
}

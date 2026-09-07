<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import { MONTHS_LONG, WEEKDAYS, type CalendarWeek } from '$lib/domain/training-plan';
	import type { PlannedDay } from '$lib/domain/types';
	import { addDaysISO } from '$lib/domain/utils';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import { cn } from '$lib/ui/cn';
	import { optionsOn, type PlanOption } from './plan-options';

	/**
	 * The year as it was actually planned: one mark per day that holds something.
	 * At chip size a week carries only a letter and a color, so the legend above
	 * is what makes the colors mean anything, and a week opens in the week view
	 * where a day is changed.
	 */
	let {
		weeks,
		options,
		plan
	}: {
		weeks: CalendarWeek[];
		options: PlanOption[];
		plan: PlannedDay[];
	} = $props();

	/**
	 * The week view, opened on this week: the route with the Monday it should
	 * show. Typed as a resolved path so the link is one, rather than a string
	 * that happens to look like one.
	 */
	function weekHref(week: CalendarWeek): ResolvedPathname {
		return resolve(`/exercise/plan?from=${week.startISO}`);
	}

	/** Each week as its seven days, so the row draws what is there rather than a frequency. */
	function weekDays(week: CalendarWeek): PlanOption[][] {
		return WEEKDAYS.map((_, index) =>
			optionsOn(options, routineIdsOn(plan, addDaysISO(week.startISO, index)))
		);
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap gap-x-3.5 gap-y-1.5 px-1">
		{#each options as option (option.id)}
			<span class="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
				<span class={cn('size-2 rounded-xs', option.tone.solid)}></span>
				{option.name}
			</span>
		{/each}
	</div>
	<div class="grid grid-cols-2 gap-x-2.5 gap-y-3">
		{#each MONTHS_LONG as name, month (name)}
			<section class="bg-card shadow-border rounded-2xl p-2">
				<SectionLabel class="mb-1.5 ml-0.5">{name.slice(0, 3)}</SectionLabel>
				<div class="flex flex-col gap-1">
					{#each weeks.filter((week) => week.month === month) as week (week.week)}
						{@const days = weekDays(week)}
						{@const trained = days.filter((day) => day.length > 0)}
						{@const lead = trained[0]?.[0]}
						<a
							href={weekHref(week)}
							aria-label={`Week ${week.week}, ${trained.length === 0 ? 'nothing planned' : `${trained.length} days planned`}`}
							class={cn(
								'flex h-5 w-full items-center gap-1.5 rounded-md px-1',
								lead?.tone.tint ?? 'hover:bg-secondary'
							)}
						>
							<span
								class={cn(
									'w-2 text-left text-[9px] font-semibold',
									lead?.tone.ink ?? 'text-border'
								)}
							>
								{lead?.letter ?? '·'}
							</span>
							<span class="flex flex-1 gap-0.5">
								{#each days as day, index (index)}
									<span class={cn('h-1 flex-1 rounded-xs', day[0]?.tone.solid ?? 'bg-border')}
									></span>
								{/each}
							</span>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

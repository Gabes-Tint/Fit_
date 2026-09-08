<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import { calendarWeeks, MONTHS_LONG, WEEKDAYS, weekOf } from '$lib/domain/training-plan';
	import { addDaysISO, parseISODate, startOfWeek, todayISO, weekdayLong } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import DayRoutineSheet from '$lib/components/exercise/DayRoutineSheet.svelte';
	import PlanDayRow from '$lib/components/exercise/PlanDayRow.svelte';
	import { optionsOn, planOptions } from '$lib/components/exercise/plan-options';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';

	/** A `from` that is not a date is somebody's typing, not a week: fall back rather than land in 1970. */
	const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

	const today = todayISO();
	const yearHref = resolve('/exercise/plan/year');
	const arrivedAt = page.url.searchParams.get('from') ?? '';

	/** The week on show. The year view names one on the way in; otherwise it is this one. */
	let monday = $state(startOfWeek(ISO_DATE.test(arrivedAt) ? arrivedAt : today));
	let picked = $state('');
	let open = $state(false);

	/** A deleted routine is not offered by the day picker, or counted toward whether there is anything to plan. */
	const routines = $derived(tend.routines);
	/** The picker only ever offers a routine still in the rotation. */
	const options = $derived(planOptions(routines));
	/**
	 * Every routine, deleted ones included, so a day already behind today can
	 * still show what it was planned for — the same reason `TrainingWeekStrip`
	 * reads the unfiltered list.
	 */
	const allOptions = $derived(planOptions(tend.state.routines));
	const at = $derived(weekOf(monday));
	const label = $derived(calendarWeeks(at.year).find((week) => week.week === at.week)?.label ?? '');

	const days = $derived(
		WEEKDAYS.map((name, index) => {
			const iso = addDaysISO(monday, index);
			return {
				iso,
				label: `${name} ${parseISODate(iso).getDate()}`,
				on: optionsOn(allOptions, routineIdsOn(tend.state.trainingPlan, iso)),
				isToday: iso === today
			};
		})
	);

	const planned = $derived(days.filter((day) => day.on.length > 0).length);

	const sheetDay = $derived.by(() => {
		if (picked === '') return null;
		const date = parseISODate(picked);
		return {
			heading: weekdayLong(picked),
			when: `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`
		};
	});

	function openDay(iso: string) {
		picked = iso;
		open = true;
	}
</script>

<svelte:head>
	<title>Plan · Fit_</title>
</svelte:head>

<div class="flex flex-col gap-5 pb-10">
	<ScreenHeader back="/exercise" title="Plan">
		{#snippet action()}
			<LinkButton variant="outline" size="sm" href={yearHref}>Year</LinkButton>
		{/snippet}
	</ScreenHeader>

	{#if tend.state.routines.length === 0}
		<EmptyState title="Nothing to plan yet">
			A day holds the routines you mean to train that day. Add a routine first, then the week has
			something to hold.
			{#snippet action()}
				<LinkButton href={resolve('/exercise')}>Back to Exercise</LinkButton>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<button
				type="button"
				aria-label="Previous week"
				onclick={() => (monday = addDaysISO(monday, -7))}
				class="bg-secondary text-foreground flex size-10 items-center justify-center rounded-2xl"
			>
				<ChevronLeft class="size-4" />
			</button>
			<div class="text-center">
				<h1 class="font-display text-2xl">Week {at.week}</h1>
				<p class="text-muted-foreground text-xs">{label} · {planned} of 7 days planned</p>
			</div>
			<button
				type="button"
				aria-label="Next week"
				onclick={() => (monday = addDaysISO(monday, 7))}
				class="bg-secondary text-foreground flex size-10 items-center justify-center rounded-2xl"
			>
				<ChevronRight class="size-4" />
			</button>
		</div>

		<div class="flex flex-col gap-2">
			{#each days as day (day.iso)}
				<PlanDayRow
					label={day.label}
					sessions={day.on}
					isToday={day.isToday}
					onpick={() => openDay(day.iso)}
				/>
			{/each}
		</div>

		<p class="text-muted-foreground px-1 text-xs">
			Tap a day to put a routine on it. A day can hold more than one — a lift in the morning, a run
			in the evening — and a day left empty is a rest day.
		</p>
	{/if}
</div>

<DayRoutineSheet
	bind:open
	day={sheetDay}
	{options}
	chosen={routineIdsOn(tend.state.trainingPlan, picked)}
	onpick={(routineId: string) => tend.planDay(picked, routineId)}
	onclose={() => (open = false)}
/>

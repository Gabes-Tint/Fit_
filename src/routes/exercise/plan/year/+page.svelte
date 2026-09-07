<script lang="ts">
	import { resolve } from '$app/paths';
	import { plannedDaysBetween } from '$lib/domain/planned-days';
	import { calendarWeeks, WEEKS_IN_YEAR } from '$lib/domain/training-plan';
	import { tend } from '$lib/state/tend.svelte';
	import { planOptions } from '$lib/components/exercise/plan-options';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import YearMonthGrid from '$lib/components/exercise/YearMonthGrid.svelte';

	const year = new Date().getFullYear();
	const weeks = calendarWeeks(year);

	const routines = $derived(tend.state.routines);
	const options = $derived(planOptions(routines));
	const plan = $derived(tend.state.trainingPlan);
	/**
	 * Weeks with something in them, not days: the grid draws a year of weeks, and
	 * "12 of 52" is the shape of the year at a glance where a count of days is not.
	 */
	const planned = $derived(
		weeks.filter((week) => plannedDaysBetween(plan, week.startISO, week.endISO).length > 0).length
	);
</script>

<svelte:head>
	<title>Plan year · Fit_</title>
</svelte:head>

<div class="flex flex-col gap-4 pb-10">
	<ScreenHeader back="/exercise/plan" backLabel="Back to the week" title={String(year)}>
		{#snippet action()}
			<span class="text-muted-foreground pr-2 text-xs">{planned}/{WEEKS_IN_YEAR} planned</span>
		{/snippet}
	</ScreenHeader>

	{#if routines.length === 0}
		<p class="text-muted-foreground px-1 text-sm">
			There is no year to draw until a routine exists.
			<a href={resolve('/exercise')} class="text-primary underline">Add one on Exercise</a>.
		</p>
	{:else}
		<YearMonthGrid {weeks} {options} {plan} />
	{/if}
</div>

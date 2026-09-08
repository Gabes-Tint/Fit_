<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChartColumn from '@lucide/svelte/icons/chart-no-axes-column';
	import Plus from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { todayISO, weekdayLong } from '$lib/domain/utils';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import { tend } from '$lib/state/tend.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import FirstRunTemplates from '$lib/components/exercise/FirstRunTemplates.svelte';
	import ResumeWorkoutBanner from '$lib/components/exercise/ResumeWorkoutBanner.svelte';
	import RoutineRow from '$lib/components/exercise/RoutineRow.svelte';
	import TodaySessionCard from '$lib/components/exercise/TodaySessionCard.svelte';
	import TrainingWeekStrip from '$lib/components/exercise/TrainingWeekStrip.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';

	const today = todayISO();

	/** What a person picks from and sees offered — a deleted routine drops out here. */
	const routines = $derived(tend.routines);
	/**
	 * Every routine ever made, deleted ones included. `TrainingWeekStrip` shows
	 * past days too, and a past day still has to name the routine it asked for
	 * even after that routine is gone from the rotation.
	 */
	const allRoutines = $derived(tend.state.routines);
	const workouts = $derived(tend.state.workouts);
	/** Today's routines, so the rotation below marks what is on today. */
	const todayIds = $derived(routineIdsOn(tend.state.trainingPlan, today));

	/**
	 * The shelf and the empty today-card are different states. A first-run app
	 * (no routines, nothing trained) opens on the shelf; a deleted rotation
	 * keeps the home screen, and `asked` is how its empty card re-opens it.
	 */
	let asked = $state(false);
	const firstRun = $derived(routines.length === 0 && workouts.length === 0);
	const templates = $derived(asked || firstRun);

	function useTemplate(templateId: string) {
		tend.useTemplate(templateId);
		asked = false;
	}

	async function buildRoutine() {
		const routine = tend.createRoutine();
		await goto(resolve('/exercise/routines/[id]/edit', { id: routine.id }));
	}

	async function startRoutine(routineId: string) {
		if (tend.startWorkout(routineId)) await goto(resolve('/exercise/session'));
	}
</script>

<svelte:head>
	<title>Exercise · Fit_</title>
</svelte:head>

{#if templates}
	<FirstRunTemplates onpick={useTemplate} onopen={buildRoutine} />
{:else}
	<div class="flex flex-col gap-6 pb-10">
		<ResumeWorkoutBanner workout={tend.state.activeWorkout} />

		<div class="flex items-start justify-between gap-2">
			<PageHeader kicker={weekdayLong(today)} title="Exercise" />
			<div class="flex shrink-0 gap-2 pt-1">
				<LinkButton href={resolve('/exercise/plan')} variant="outline">
					<CalendarDays class="size-4" />
					Plan
				</LinkButton>
				<LinkButton
					href={resolve('/exercise/progress')}
					variant="outline"
					size="icon"
					aria-label="Training progress"
				>
					<ChartColumn class="size-4" />
				</LinkButton>
			</div>
		</div>

		<TodaySessionCard
			{routines}
			{today}
			{workouts}
			plan={tend.state.trainingPlan}
			onstart={startRoutine}
			onpick={() => (asked = true)}
			onopen={buildRoutine}
		/>

		<TrainingWeekStrip routines={allRoutines} {today} {workouts} plan={tend.state.trainingPlan} />

		<div class="flex flex-col gap-2">
			<div class="flex items-baseline justify-between px-1">
				<SectionLabel>Routines</SectionLabel>
				<span class="text-muted-foreground text-xs">{routines.length} in rotation</span>
			</div>
			{#each routines as routine, index (routine.id)}
				<RoutineRow
					{routine}
					{index}
					current={todayIds.includes(routine.id)}
					onstart={startRoutine}
				/>
			{/each}
			<button
				type="button"
				onclick={buildRoutine}
				class="border-border text-muted-foreground flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed text-sm"
			>
				<Plus class="size-4" />
				New routine
			</button>
		</div>
	</div>
{/if}

<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import X from '@lucide/svelte/icons/x';
	import { resolve } from '$app/paths';
	import {
		computeTargets,
		loggedDatesSet,
		nutritionForDay,
		rollingAverages
	} from '$lib/domain/tdee';
	import { isGlp1, servingStep } from '$lib/domain/profile';
	import { calendarWeeks, weekOf } from '$lib/domain/training-plan';
	import { weeklyAdherence } from '$lib/domain/training-progress';
	import { trainingWeekText } from '$lib/domain/today-status';
	import { MEALS, type Meal } from '$lib/domain/types';
	import { todayISO, weekdayLong } from '$lib/domain/utils';
	import { logUi } from '$lib/state/log-ui.svelte';
	import { tend } from '$lib/state/tend.svelte';
	import { cn } from '$lib/ui/cn';
	import { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS } from '$lib/ui/button-variants';
	import LogRow from './LogRow.svelte';
	import PageHeader from './PageHeader.svelte';
	import GlpRingCluster from './GlpRingCluster.svelte';
	import MacroRing from './MacroRing.svelte';
	import MiniStat from './MiniStat.svelte';
	import WeekStrip from './WeekStrip.svelte';
	import WeightChart from './WeightChart.svelte';
	import WeightEntry from './WeightEntry.svelte';

	let day = $state(todayISO());
	let editing = $state<string | null>(null);
	// Starts collapsed on every visit (#the today card actions issue): nothing
	// persists it open across a reload.
	let weightExpanded = $state(false);

	// One round action button, reused for the Energy, Weight and Training card
	// corners: computed once rather than re-run through `cn` at every call site.
	const CARD_ACTION_CLASS = cn(BUTTON_BASE, BUTTON_VARIANTS.default, BUTTON_SIZES['icon-round']);
	const CARD_CLOSE_CLASS = cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, BUTTON_SIZES.icon);

	const profile = $derived(tend.profile);

	function greetingFor(loggedDays: number) {
		if (loggedDays === 0) return 'Whenever you log is a good time.';
		return `${loggedDays} day${loggedDays === 1 ? '' : 's'} logged this week.`;
	}

	function logMeal(meal: Meal) {
		logUi.show(undefined, meal);
	}
</script>

{#if profile}
	{@const targets = computeTargets(profile)}
	{@const dayTotals = nutritionForDay(profile.log, day)}
	{@const week = rollingAverages(profile.log, 7)}
	{@const food = loggedDatesSet(profile.log)}
	{@const weightDays = new Set(profile.weights.map((w) => w.date))}
	{@const exerciseDays = new Set(
		tend.state.workouts.filter((w) => w.finishedAt !== null).map((w) => w.date)
	)}
	{@const items = profile.log.filter((i) => i.date === day)}
	<!-- GLP-1 users are steered by protein, so the layout changes, not just the order. -->
	{@const primaryProtein = isGlp1(profile)}
	{@const nowWeek = weekOf(todayISO())}
	{@const thisWeek = weeklyAdherence({
		workouts: tend.state.workouts,
		plan: tend.state.trainingPlan,
		weeks: calendarWeeks(nowWeek.year),
		throughWeek: nowWeek.week,
		count: 1
	})[0] ?? { planned: 0, done: 0 }}
	{@const trainingText = trainingWeekText(thisWeek)}
	<div class="flex flex-col gap-6 pb-8">
		<PageHeader kicker={weekdayLong(day)} title="Today">
			{greetingFor(week.loggedDays)}
		</PageHeader>

		<WeekStrip {food} exercise={exerciseDays} weight={weightDays} bind:selected={day} />

		<section
			class="bg-card relative rounded-3xl px-3 py-5 shadow-border"
			aria-labelledby="today-energy-title"
		>
			<h2 id="today-energy-title" class="font-display px-1 text-xl tracking-tight">Energy</h2>
			<div class="mt-2 flex items-start justify-center gap-3">
				{#if primaryProtein}
					<GlpRingCluster
						energyValue={dayTotals.kcal}
						energyTarget={targets.kcal}
						proteinValue={dayTotals.protein}
						proteinTarget={targets.protein}
						fiberValue={dayTotals.fiber}
						fiberTarget={targets.fiber}
					/>
				{:else}
					<MacroRing value={dayTotals.kcal} target={targets.kcal} unit="kcal" emphasis size={148} />
					<div class="flex flex-col justify-center gap-3 pt-2 text-sm">
						<MiniStat label="Protein" value={dayTotals.protein} target={targets.protein} unit="g" />
						<MiniStat label="Carbs" value={dayTotals.carbs} target={targets.carbs} unit="g" />
						<MiniStat label="Fat" value={dayTotals.fat} target={targets.fat} unit="g" />
					</div>
				{/if}
			</div>
			<button
				type="button"
				aria-label="Log food"
				onclick={() => logUi.show()}
				class={cn(CARD_ACTION_CLASS, 'absolute right-3 bottom-3')}
			>
				<Plus class="size-5" />
			</button>
		</section>

		<section
			class="bg-card relative rounded-3xl p-4 shadow-border"
			aria-labelledby="today-weight-title"
		>
			<h2 id="today-weight-title" class="font-display px-1 text-xl tracking-tight">Weight</h2>
			<div class="mt-1 h-44 pr-16">
				<WeightChart weights={profile.weights} units={tend.state.units} />
			</div>
			{#if weightExpanded}
				<!--
					pb-20 clears the fixed `LogFab`: once this card expands and the page
					scrolls to bring the form into view, the "Today" submit button can
					otherwise land under the same screen position the floating log
					button occupies, so a tap saves nothing and opens the food sheet
					instead (#today-card-actions review). The FAB itself is untouched —
					it stays reachable everywhere, this card just leaves it room.
				-->
				<div class="flex flex-col gap-2 px-1 pb-20">
					<div class="flex items-center justify-end">
						<button
							type="button"
							aria-label="Close"
							onclick={() => (weightExpanded = false)}
							class={CARD_CLOSE_CLASS}
						>
							<X class="size-4" />
						</button>
					</div>
					<WeightEntry units={tend.state.units} />
				</div>
			{:else}
				<button
					type="button"
					aria-label="Log weight"
					onclick={() => (weightExpanded = true)}
					class={cn(CARD_ACTION_CLASS, 'absolute right-3 bottom-3')}
				>
					<Plus class="size-5" />
				</button>
			{/if}
		</section>

		<section
			class="bg-card relative rounded-3xl px-4 py-3 pr-16 shadow-border text-sm"
			aria-labelledby="today-training-title"
		>
			<h2 id="today-training-title" class="font-display px-1 text-xl tracking-tight">Training</h2>
			<div role="group" aria-label="This week's training">
				<p class="mt-0.5">{trainingText}</p>
			</div>
			<a
				href={resolve('/exercise')}
				aria-label="Go to training"
				class={cn(CARD_ACTION_CLASS, 'absolute right-3 bottom-3')}
			>
				<ArrowRight class="size-5" />
			</a>
		</section>

		{#each MEALS as meal (meal)}
			{@const group = items.filter((i) => i.meal === meal)}
			<section>
				<div class="mb-2 flex items-baseline justify-between px-1">
					<div class="flex items-center gap-1">
						<h2 class="font-display text-xl tracking-tight capitalize">{meal}</h2>
						<button
							type="button"
							aria-label="Log {meal}"
							onclick={() => logMeal(meal)}
							class="text-foreground hover:bg-secondary flex size-8 items-center justify-center rounded-xl"
						>
							<Plus class="size-4" />
						</button>
					</div>
					<span class="tabular text-muted-foreground text-xs">
						{group.reduce((s, i) => s + i.kcal, 0)} kcal
					</span>
				</div>
				{#if group.length === 0}
					<button
						type="button"
						onclick={() => logMeal(meal)}
						class="border-border text-muted-foreground flex h-16 w-full items-center justify-center rounded-2xl border border-dashed text-sm"
					>
						Nothing here. That’s fine.
					</button>
				{:else}
					<ul class="flex flex-col gap-1.5">
						{#each group as item (item.id)}
							<LogRow
								{item}
								open={editing === item.id}
								step={servingStep(profile)}
								ontoggle={() => (editing = editing === item.id ? null : item.id)}
							/>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
{/if}

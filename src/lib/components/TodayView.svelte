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
	// `icon-round-sm` rather than `icon-round`: the plain full-size circle sat
	// too close to the ring, the macro bars and the training text above it
	// (#today-card-actions polish), so the visible circle steps down while the
	// card padding below grows to give it room, and the tap target stays 44px
	// regardless.
	const CARD_ACTION_CLASS = cn(BUTTON_BASE, BUTTON_VARIANTS.default, BUTTON_SIZES['icon-round-sm']);
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
			class="bg-card relative rounded-3xl px-3 pt-5 pb-8 shadow-border"
			aria-labelledby="today-energy-title"
		>
			<h2 id="today-energy-title" class="font-display px-1 text-xl tracking-tight">Energy</h2>
			<div class="mt-2 flex items-start justify-center gap-3">
				<MacroRing value={dayTotals.kcal} target={targets.kcal} unit="kcal" emphasis size={148} />
				<div class="flex flex-col justify-center gap-3 pt-2 text-sm">
					<MiniStat
						label="Protein"
						value={dayTotals.protein}
						target={targets.protein}
						unit="g"
						color="bg-destructive"
					/>
					{#if primaryProtein}
						<MiniStat
							label="Fiber"
							value={dayTotals.fiber}
							target={targets.fiber}
							unit="g"
							color="bg-sage-soft"
						/>
					{:else}
						<MiniStat
							label="Carbs"
							value={dayTotals.carbs}
							target={targets.carbs}
							unit="g"
							color="bg-foreground"
						/>
						<MiniStat
							label="Fat"
							value={dayTotals.fat}
							target={targets.fat}
							unit="g"
							color="bg-muted-foreground"
						/>
					{/if}
				</div>
			</div>
			<button
				type="button"
				aria-label="Log food"
				onclick={() => logUi.show()}
				class={cn(
					CARD_ACTION_CLASS,
					'absolute bottom-3',
					tend.state.leftHanded ? 'left-3' : 'right-3'
				)}
			>
				<Plus class="size-5" />
			</button>
		</section>

		<section
			class="bg-card rounded-3xl px-4 pt-3 pb-3 shadow-border"
			aria-labelledby="today-weight-title"
		>
			<h2 id="today-weight-title" class="font-display px-1 text-xl tracking-tight">Weight</h2>
			<div class="mt-1 h-[140px]">
				<WeightChart weights={profile.weights} units={tend.state.units} />
			</div>
			{#if weightExpanded}
				<div class="mt-3 flex items-center justify-end px-1">
					<button
						type="button"
						aria-label="Close"
						onclick={() => (weightExpanded = false)}
						class={CARD_CLOSE_CLASS}
					>
						<X class="size-4" />
					</button>
				</div>
				<div class="flex flex-col gap-2 px-1">
					<WeightEntry units={tend.state.units} />
				</div>
			{:else}
				<div class={cn('mt-1 flex', tend.state.leftHanded ? 'justify-start' : 'justify-end')}>
					<button
						type="button"
						aria-label="Log weight"
						onclick={() => (weightExpanded = true)}
						class={CARD_ACTION_CLASS}
					>
						<Plus class="size-5" />
					</button>
				</div>
			{/if}
		</section>

		<section
			class="bg-card rounded-3xl px-4 pt-3 pb-6 shadow-border text-sm"
			aria-labelledby="today-training-title"
		>
			<div
				class={cn(
					'flex items-center justify-between gap-3',
					tend.state.leftHanded && 'flex-row-reverse'
				)}
			>
				<div class="min-w-0 flex-1">
					<h2 id="today-training-title" class="font-display px-1 text-xl tracking-tight">
						Training
					</h2>
					<div role="group" aria-label="This week's training">
						<p class="mt-0.5">{trainingText}</p>
					</div>
				</div>
				<a href={resolve('/exercise')} aria-label="Go to training" class={CARD_ACTION_CLASS}>
					<ArrowRight class="size-5" />
				</a>
			</div>
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

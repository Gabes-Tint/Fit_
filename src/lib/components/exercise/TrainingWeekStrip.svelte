<script lang="ts">
	import { resolve } from '$app/paths';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import { WEEKDAYS } from '$lib/domain/training-plan';
	import type { PlannedDay, Routine, Workout } from '$lib/domain/types';
	import { addDaysISO, startOfWeek } from '$lib/domain/utils';
	import { countsAsTraining } from '$lib/domain/workout';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import { optionsOn, planOptions } from '$lib/components/exercise/plan-options';
	import { cn } from '$lib/ui/cn';

	/**
	 * Read-only: every cell links to the planner, where a day is actually
	 * changed. What a day is marked with comes from what was put on it — a day
	 * can hold two routines, and it shows both initials in that order.
	 */
	let {
		routines,
		plan,
		workouts,
		today
	}: {
		routines: Routine[];
		plan: PlannedDay[];
		/** Filed workouts; the unfinished one has not happened yet. */
		workouts: Workout[];
		today: string;
	} = $props();

	const options = $derived(planOptions(routines));

	const days = $derived.by(() => {
		const monday = startOfWeek(today);
		return WEEKDAYS.map((label, i) => {
			const iso = addDaysISO(monday, i);
			const on = optionsOn(options, routineIdsOn(plan, iso));
			const isToday = iso === today;
			// A session filed with nothing ticked is not a trained day.
			const done = iso < today && workouts.some((w) => w.date === iso && countsAsTraining(w));
			const name = isToday ? 'Today' : label;
			return {
				iso,
				label: name,
				isToday,
				done,
				letters: on.map((option) => option.letter).join(''),
				// The first routine of the day gives the cell its color; a day with
				// nothing on it has none.
				tone: on[0]?.tone,
				// The cell's glyphs read as nothing to a screen reader, so the label
				// names what is actually on the day rather than describing the marks.
				description: `${name}, ${
					on.length > 0 ? on.map((option) => option.name).join(', then ') : 'rest day'
				}${done ? ', trained' : ''}`
			};
		});
	});
</script>

<div>
	<div class="flex items-baseline justify-between px-1 pb-2">
		<SectionLabel>This week</SectionLabel>
		<a href={resolve('/exercise/plan')} class="text-muted-foreground text-xs">Edit plan</a>
	</div>
	<div class="flex gap-1.5">
		{#each days as day (day.iso)}
			<a
				href={resolve('/exercise/plan')}
				aria-label={day.description}
				class={cn(
					'flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-2xl',
					'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
					day.isToday
						? 'bg-primary text-primary-foreground'
						: 'bg-card text-foreground hover:bg-secondary shadow-border'
				)}
			>
				<span class="text-xs opacity-85">{day.label}</span>
				<span
					class={cn(
						'text-[0.65rem] font-semibold',
						day.isToday ? 'opacity-90' : (day.tone?.ink ?? 'text-muted-foreground')
					)}
				>
					{day.letters || '·'}
				</span>
				<span
					class={cn(
						'size-1.5 rounded-full',
						day.done
							? 'bg-primary'
							: day.isToday
								? 'bg-primary-foreground/50'
								: day.tone
									? ['border-[1.5px]', day.tone.dot]
									: 'bg-border'
					)}
				></span>
			</a>
		{/each}
	</div>
</div>

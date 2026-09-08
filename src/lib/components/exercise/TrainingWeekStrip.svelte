<script lang="ts">
	import { resolve } from '$app/paths';
	import DayStrip from '$lib/components/DayStrip.svelte';
	import { DAY_STRIP_CELL } from '$lib/components/day-strip';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import type { PlannedDay, Routine, Workout } from '$lib/domain/types';
	import { dayStripLabel } from '$lib/domain/week-strip';
	import { countsAsTraining } from '$lib/domain/workout';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import { optionsOn, planOptions } from '$lib/components/exercise/plan-options';
	import { cn } from '$lib/ui/cn';

	/**
	 * Read-only: every cell links to the planner, where a day is actually
	 * changed. What a day is marked with comes from what was put on it — a day
	 * can hold two routines, and it shows both initials in that order. Spans
	 * the same 30-days-back/7-forward range as the home strip, so today is
	 * given the literal label "Today" rather than its weekday+number, which
	 * would otherwise be indistinguishable from the same weekday a month away.
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

	function dayInfo(iso: string, isToday: boolean) {
		const on = optionsOn(options, routineIdsOn(plan, iso));
		// A session filed with nothing ticked is not a trained day.
		const done = iso < today && workouts.some((w) => w.date === iso && countsAsTraining(w));
		const label = isToday ? 'Today' : dayStripLabel(iso);
		return {
			label,
			done,
			letters: on.map((option) => option.letter).join(''),
			// The first routine of the day gives the cell its color; a day with
			// nothing on it has none.
			tone: on[0]?.tone,
			// The cell's glyphs read as nothing to a screen reader, so the label
			// names what is actually on the day rather than describing the marks.
			description: `${label}, ${
				on.length > 0 ? on.map((option) => option.name).join(', then ') : 'rest day'
			}${done ? ', trained' : ''}`
		};
	}
</script>

<div>
	<div class="flex items-baseline justify-between px-1 pb-2">
		<SectionLabel>Training</SectionLabel>
		<a href={resolve('/exercise/plan')} class="text-muted-foreground text-xs">Edit plan</a>
	</div>
	<DayStrip {today}>
		{#snippet children({
			iso,
			isToday,
			attach,
			onkeydown
		}: {
			iso: string;
			isToday: boolean;
			attach: (el: HTMLElement) => void;
			onkeydown: (event: KeyboardEvent) => void;
		})}
			{@const day = dayInfo(iso, isToday)}
			<a
				href={resolve('/exercise/plan')}
				aria-label={day.description}
				{onkeydown}
				{@attach attach}
				class={cn(
					DAY_STRIP_CELL,
					'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
					isToday
						? 'bg-primary text-primary-foreground'
						: 'bg-card text-foreground hover:bg-secondary shadow-border'
				)}
			>
				<span class="text-xs opacity-85">{day.label}</span>
				<span
					class={cn(
						'text-[0.65rem] font-semibold',
						isToday ? 'opacity-90' : (day.tone?.ink ?? 'text-muted-foreground')
					)}
				>
					{day.letters || '·'}
				</span>
				<span
					class={cn(
						'size-1.5 rounded-full',
						day.done
							? 'bg-primary'
							: isToday
								? 'bg-primary-foreground/50'
								: day.tone
									? ['border-[1.5px]', day.tone.dot]
									: 'bg-border'
					)}
				></span>
			</a>
		{/snippet}
	</DayStrip>
</div>

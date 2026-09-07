<script lang="ts">
	import { calendarWeeks, weekOf } from '$lib/domain/training-plan';
	import { weeklyAdherence } from '$lib/domain/training-progress';
	import type { PlannedDay, Workout } from '$lib/domain/types';
	import { todayISO } from '$lib/domain/utils';

	let { workouts, plan }: { workouts: Workout[]; plan: PlannedDay[] } = $props();

	const now = weekOf(todayISO());

	const weeks = $derived(
		weeklyAdherence({
			workouts,
			plan,
			weeks: calendarWeeks(now.year),
			throughWeek: now.week
		})
	);

	// A week the plan left empty has nothing to fall short of, so report the count, not a ratio.
	const rows = $derived(
		weeks.map((w) => ({
			...w,
			cells: Array.from({ length: w.planned }, (_, i) => i < w.done),
			text: w.planned === 0 ? `${w.done} done` : `${w.done} of ${w.planned}`,
			met: w.done >= w.planned
		}))
	);

	const quiet = $derived(rows.every((r) => r.planned === 0 && r.done === 0));
</script>

<section class="bg-card rounded-3xl p-4 shadow-border">
	<h2 class="font-display text-lg tracking-tight">Planned vs. done</h2>
	<p class="text-muted-foreground mt-1 text-xs">
		Against what the calendar holds. A missed week is information, not a failure.
	</p>
	{#if quiet}
		<p class="text-muted-foreground mt-3 text-sm">
			Nothing planned or done in these weeks, so there is nothing to hold them against.
		</p>
	{:else}
		<ul class="mt-3 flex flex-col gap-2">
			{#each rows as row (row.week)}
				<li class="flex items-center gap-2.5">
					<span class="w-16 shrink-0 text-xs">{row.label}</span>
					<span class="flex flex-1 gap-1" aria-hidden="true">
						{#each row.cells as filled, i (i)}
							<span class={['h-5 flex-1 rounded-lg', filled ? 'bg-primary' : 'bg-secondary']}
							></span>
						{/each}
					</span>
					<span
						class={[
							'tabular w-14 shrink-0 text-right text-xs',
							row.met ? 'text-primary' : 'text-muted-foreground'
						]}
					>
						{row.text}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<script lang="ts">
	import { personalRecords } from '$lib/domain/training-progress';
	import type { Workout } from '$lib/domain/types';
	import { displayLoad } from '$lib/domain/units';
	import { monthDay } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';

	let { workouts }: { workouts: Workout[] } = $props();

	/** A record is the heaviest set in kilograms; the unit decides how it reads. */
	const unit = $derived(tend.state.loadUnit);

	const records = $derived(
		personalRecords(workouts).map((r) => ({
			name: r.name,
			best: `${displayLoad(r.load, unit)} ${unit} × ${r.reps}`,
			when: monthDay(r.date)
		}))
	);
</script>

<section class="bg-accent text-accent-foreground rounded-3xl p-4">
	<h2 class="font-display text-lg tracking-tight">Heaviest so far</h2>
	{#if records.length === 0}
		<p class="text-muted-foreground mt-1 text-sm">
			Nothing loaded yet, so there is no best set to name.
		</p>
	{:else}
		<ul class="mt-2.5 flex flex-col gap-2">
			{#each records as record (record.name)}
				<li class="flex items-baseline gap-2.5">
					<span class="text-foreground min-w-0 flex-1 truncate text-sm">{record.name}</span>
					<span class="tabular text-sm font-medium">{record.best}</span>
					<span class="text-foreground/70 text-xs">{record.when}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

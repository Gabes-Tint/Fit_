<script lang="ts">
	import CirclePlay from '@lucide/svelte/icons/circle-play';
	import type { LoadUnit, RoutineExercise } from '$lib/domain/types';
	import { formatLoad } from '$lib/domain/units';
	import Button from '$lib/ui/Button.svelte';
	import { cn } from '$lib/ui/cn';
	import Stepper from '$lib/ui/Stepper.svelte';
	import { SHEET_GRID } from './sheet-grids';

	/**
	 * Sets and reps belong to the plan and change in the builder; the load drifts
	 * week to week, so it is the one this row edits in place.
	 */
	let {
		exercise,
		unit,
		open,
		ontoggle,
		onplay,
		onload
	}: {
		exercise: RoutineExercise;
		/** The unit `exercise.load` — kilograms, always — is read in. */
		unit: LoadUnit;
		open: boolean;
		ontoggle: () => void;
		onplay: () => void;
		onload: (direction: number) => void;
	} = $props();

	const load = $derived(formatLoad(exercise.load, unit));
	const watchLabel = $derived(`Watch ${exercise.name}`);
</script>

<div class={cn('border-border/60 border-b last:border-b-0', open && 'bg-background')}>
	<div class="flex items-center">
		<button
			type="button"
			onclick={onplay}
			aria-label={watchLabel}
			class="text-muted-foreground hover:bg-accent hover:text-primary ml-2 flex size-7 shrink-0 items-center justify-center rounded-lg"
		>
			<CirclePlay class="size-4" />
		</button>
		<button
			type="button"
			onclick={ontoggle}
			aria-expanded={open}
			class={cn(SHEET_GRID, 'min-w-0 flex-1 py-2.5 pr-3 pl-1 text-left')}
		>
			<span class="truncate text-sm">{exercise.name}</span>
			<span class="tabular text-muted-foreground text-center text-sm">{exercise.sets}</span>
			<span class="tabular text-muted-foreground text-center text-sm">{exercise.reps}</span>
			<span
				class={cn(
					'tabular text-right text-sm font-medium',
					exercise.load === 0 && 'text-muted-foreground'
				)}
			>
				{load}
			</span>
		</button>
	</div>
	{#if open}
		<div class="flex items-center gap-2 pr-3 pb-3 pl-9">
			<span class="text-muted-foreground text-xs">Load</span>
			<Stepper value={load} label="load" onstep={onload} />
			<Button size="sm" class="ml-auto" onclick={ontoggle}>Done</Button>
		</div>
	{/if}
</div>

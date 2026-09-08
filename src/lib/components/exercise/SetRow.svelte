<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import type { LoadUnit, WorkoutSet } from '$lib/domain/types';
	import { formatLoad } from '$lib/domain/units';
	import { cn } from '$lib/ui/cn';
	import Stepper from '$lib/ui/Stepper.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';
	import { SET_GRID } from './sheet-grids';

	/**
	 * Reps and load stay adjustable after a set is ticked, since the planned and
	 * the lifted number often differ.
	 */
	let {
		number,
		set,
		unit,
		onstep,
		ontoggle
	}: {
		number: number;
		set: WorkoutSet;
		/** The unit `set.load` — kilograms, always — is read in. */
		unit: LoadUnit;
		onstep: (field: 'reps' | 'load', direction: number) => void;
		ontoggle: () => void;
	} = $props();
</script>

<div class={cn(SET_GRID, 'items-center rounded-2xl px-1 py-1', set.done && 'bg-muted/70')}>
	<span
		class={cn(
			'tabular flex size-7 items-center justify-center rounded-lg text-xs',
			set.done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
		)}
	>
		{number}
	</span>
	<Stepper
		class="justify-center"
		value={set.reps}
		label="reps on set {number}"
		onstep={(direction: number) => onstep('reps', direction)}
	/>
	<Stepper
		class="justify-center"
		value={formatLoad(set.load, unit)}
		label="load on set {number}"
		onstep={(direction: number) => onstep('load', direction)}
	/>
	<ToggleButton
		pressed={set.done}
		aria-label="Set {number} done"
		onclick={ontoggle}
		resting="text-muted-foreground"
		class="border-border flex size-9 items-center justify-center rounded-xl border"
	>
		<Check class="size-4" />
	</ToggleButton>
</div>

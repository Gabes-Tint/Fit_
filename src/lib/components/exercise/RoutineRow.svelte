<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import { resolve } from '$app/paths';
	import { routineTotals } from '$lib/domain/exercises';
	import type { Routine } from '$lib/domain/types';
	import { routineTone } from '$lib/components/exercise/routine-tone';
	import { cn } from '$lib/ui/cn';

	/** The row opens the routine; the button beside it starts it — two actions, so two targets. */
	let {
		routine,
		index,
		current = false,
		onstart
	}: {
		routine: Routine;
		/** Position in the rotation; also picks the routine's tone. */
		index: number;
		current?: boolean;
		onstart: (routineId: string) => void;
	} = $props();

	const tone = $derived(routineTone(index));
	const summary = $derived.by(() => {
		const totals = routineTotals(routine);
		return `${totals.exercises} exercises · ${totals.sets} sets`;
	});
	const startLabel = $derived(`Start ${routine.name}`);
	/**
	 * `startWorkout` refuses an empty routine, so its start control is disabled
	 * rather than left looking live.
	 */
	const empty = $derived(routine.exercises.length === 0);
</script>

<div class="bg-card flex items-center gap-1 rounded-2xl py-1 pr-2 pl-1 shadow-border">
	<a
		href={resolve('/exercise/routines/[id]', { id: routine.id })}
		class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2.5"
	>
		<span
			class={cn(
				'flex size-11 shrink-0 flex-col items-center justify-center rounded-2xl',
				current ? 'bg-primary text-primary-foreground' : [tone.tint, tone.ink]
			)}
		>
			<span class="font-display text-base leading-none">{index + 1}</span>
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{routine.name}</span>
			<span class="text-muted-foreground mt-0.5 block text-xs">{summary}</span>
		</span>
	</a>
	<button
		type="button"
		onclick={() => onstart(routine.id)}
		disabled={empty}
		aria-label={startLabel}
		class="bg-accent text-accent-foreground flex size-11 shrink-0 items-center justify-center rounded-2xl disabled:opacity-40"
	>
		<Play class="size-4" fill="currentColor" />
	</button>
</div>

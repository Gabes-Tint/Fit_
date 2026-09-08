<script lang="ts">
	import CirclePlay from '@lucide/svelte/icons/circle-play';
	import Repeat from '@lucide/svelte/icons/repeat';
	import { formatLoad } from '$lib/domain/units';
	import { lastPerformance } from '$lib/domain/workout';
	import { tend } from '$lib/state/tend.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import { cn } from '$lib/ui/cn';
	import Textarea from '$lib/ui/Textarea.svelte';
	import FormCheckModal from './FormCheckModal.svelte';
	import { SET_GRID } from './sheet-grids';
	import SetRow from './SetRow.svelte';
	import SwapSheet from './SwapSheet.svelte';

	/**
	 * The exercise the session is on. Every change goes straight to the store,
	 * so the session survives a reload mid-set.
	 */
	let {
		onlog
	}: {
		/** Fires when a set is ticked on, starting its rest. */
		onlog?: (() => void) | undefined;
	} = $props();

	let formOpen = $state(false);
	let swapOpen = $state(false);

	const workout = $derived(tend.state.activeWorkout);
	const exercise = $derived(tend.currentExercise);
	/** Loads are stored in kilograms; this is the unit every one of them is read in. */
	const unit = $derived(tend.state.loadUnit);

	function toggle(index: number, wasDone: boolean) {
		tend.toggleSet(index);
		// Ticking back corrects a set rather than ending one, so it starts no rest.
		if (!wasDone) onlog?.();
	}
</script>

{#if workout && exercise}
	{@const last = lastPerformance(tend.state.workouts, exercise.name)}
	{@const position = `Exercise ${workout.exerciseIndex + 1} of ${workout.exercises.length}`}
	{@const loadHeading = `Load (${unit})`}
	<div class="flex flex-col gap-4">
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<SectionLabel>{position}</SectionLabel>
				<div class="mt-1 flex items-center gap-2">
					<h1 class="font-display text-3xl leading-tight tracking-tight">{exercise.name}</h1>
					<button
						type="button"
						onclick={() => (formOpen = true)}
						aria-label="Watch the movement"
						class="bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-xl"
					>
						<CirclePlay class="size-5" />
					</button>
				</div>
				<div class="mt-2 flex items-center gap-2">
					<span
						class="bg-accent text-primary rounded-full px-2.5 py-1 text-xs font-medium tracking-wide uppercase"
					>
						{exercise.group}
					</span>
					<button
						type="button"
						onclick={() => (swapOpen = true)}
						class="border-border text-muted-foreground hover:bg-secondary flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs"
					>
						<Repeat class="size-3" />
						Swap
					</button>
				</div>
			</div>
			{#if last}
				{@const lastLine = `${last.reps} × ${formatLoad(last.load, unit)}${
					last.load > 0 ? ` ${unit}` : ''
				}`}
				<div class="shrink-0 text-right">
					<p class="text-muted-foreground text-xs">Last time</p>
					<p class="tabular text-sm">{lastLine}</p>
				</div>
			{/if}
		</div>

		<section class="bg-card rounded-3xl p-3 shadow-border">
			<div
				class={cn(
					SET_GRID,
					'text-muted-foreground px-1 pb-1 text-[0.625rem] tracking-[0.14em] uppercase'
				)}
			>
				<span>Set</span>
				<span class="text-center">Reps</span>
				<span class="text-center">{loadHeading}</span>
				<span></span>
			</div>
			<div class="flex flex-col gap-1.5">
				{#each exercise.sets as set, i (i)}
					<SetRow
						number={i + 1}
						{set}
						{unit}
						onstep={(field: 'reps' | 'load', direction: number) =>
							tend.bumpSet(i, field, direction)}
						ontoggle={() => toggle(i, set.done)}
					/>
				{/each}
			</div>
			<button
				type="button"
				onclick={() => tend.addSet()}
				class="border-border text-muted-foreground hover:bg-secondary mt-2 h-10 w-full rounded-2xl border border-dashed text-sm"
			>
				Add set
			</button>
		</section>

		<section>
			<label
				for="exercise-note"
				class="text-muted-foreground mb-1.5 block pl-1 text-[0.625rem] tracking-[0.14em] uppercase"
			>
				Notes
			</label>
			<Textarea
				id="exercise-note"
				class="min-h-16"
				placeholder="Anything worth remembering next time"
				bind:value={() => exercise.note, (note: string) => tend.noteExercise(note)}
			/>
		</section>
	</div>

	<FormCheckModal bind:open={formOpen} name={exercise.name} onclose={() => (formOpen = false)} />
	<SwapSheet
		bind:open={swapOpen}
		name={exercise.name}
		onclose={() => (swapOpen = false)}
		onpick={(swapped: string) => tend.swapExercise(swapped)}
	/>
{/if}

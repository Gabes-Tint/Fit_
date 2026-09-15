<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RestTimer from '$lib/components/exercise/RestTimer.svelte';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import SessionExercise from '$lib/components/exercise/SessionExercise.svelte';
	import { elapsedSeconds, formatDuration, nextUndoneSet, setCounts } from '$lib/domain/workout';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';
	import ProgressBar from '$lib/ui/ProgressBar.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';

	/** The label's `for`, spelled once so the two cannot drift apart. */
	const NOTE_ID = 'session-note';

	let now = $state(Date.now());
	let restStartedAt = $state<number | null>(null);

	const workout = $derived(tend.state.activeWorkout);
	const counts = $derived(workout ? setCounts(workout) : { done: 0, total: 0 });
	// The first still-open set in routine order, not "done + one", so a set
	// ticked out of order is never logged twice.
	const next = $derived(workout ? nextUndoneSet(workout) : null);
	const nextLabel = $derived(
		next && workout
			? `Log ${workout.exercises[next.exerciseIndex]?.name ?? ''} set ${next.setIndex + 1}`
			: 'Finish'
	);

	// Elapsed is computed from `startedAt`, so this only refreshes `now`. It
	// hangs off "a session is running", not the workout object, so a tick or
	// stepper does not restart the interval and reset the second.
	const live = $derived(workout !== null);
	$effect(() => {
		if (!live) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	function finish() {
		// Every running session is filed, ticked or not — the summary has words
		// for an empty one. Only "no session at all" has nothing to show.
		const filed = tend.finishWorkout();
		void goto(resolve(filed ? '/exercise/session/summary' : '/exercise'));
	}

	function logNext() {
		if (!next) {
			finish();
			return;
		}
		tend.toggleSet(next.setIndex, next.exerciseIndex);
		restStartedAt = Date.now();
	}
</script>

<svelte:head>
	<title>Session · Fit_</title>
</svelte:head>

<!-- Once every set is done the footer itself reads Finish, so the header's early exit steps aside. -->
{#snippet finishEarly()}
	<Button variant="outline" size="sm" onclick={finish}>Finish</Button>
{/snippet}

{#if workout}
	<div class="flex flex-col gap-5 pb-4">
		<div>
			<ScreenHeader
				back="/exercise"
				backLabel="Leave session"
				title={workout.routineName}
				action={next ? finishEarly : undefined}
			/>
			<p class="tabular text-muted-foreground pl-11 text-xs">
				{formatDuration(elapsedSeconds(workout, now))} · {counts.done} of {counts.total} sets
			</p>
			<ProgressBar class="mt-2.5" value={counts.done} target={counts.total} />
		</div>

		<div class="flex flex-col gap-10">
			{#each workout.exercises as exercise, index (index)}
				<SessionExercise {exercise} {index} onlog={() => (restStartedAt = Date.now())} />
			{/each}
		</div>

		<!--
			One note for the whole trip, at the end of the page rather than under
			each movement: what somebody writes after a session is a sentence about
			the session, and cutting it into a fragment per exercise filed it under
			whichever block happened to be on screen (#477). It sits last so the
			page reads in the order the session runs, and `scroll-mb-32` keeps it
			clear of the sticky footer when focus scrolls it into view.
		-->
		<div class="scroll-mb-32">
			<label
				for={NOTE_ID}
				class="text-muted-foreground mb-1.5 block pl-1 text-[0.625rem] tracking-[0.14em] uppercase"
			>
				Notes
			</label>
			<Textarea
				id={NOTE_ID}
				class="min-h-24"
				placeholder="How did the session go?"
				bind:value={() => workout.note, (note: string) => tend.noteWorkout(note)}
			/>
		</div>

		<div class="bg-background sticky bottom-0 flex flex-col gap-2 pt-2 pb-3">
			<RestTimer startedAt={restStartedAt} seconds={tend.state.restSeconds} />
			<Button size="lg" class="w-full" onclick={logNext}>{nextLabel}</Button>
		</div>
	</div>
{:else}
	<EmptyState title="No session running">
		Start one from a routine and it will pick up here.
		{#snippet action()}
			<LinkButton href={resolve('/exercise')}>Back to Exercise</LinkButton>
		{/snippet}
	</EmptyState>
{/if}

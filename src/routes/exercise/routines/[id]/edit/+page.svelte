<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import BuilderExerciseRow from '$lib/components/exercise/BuilderExerciseRow.svelte';
	import LibrarySheet from '$lib/components/exercise/LibrarySheet.svelte';
	import RoutineGone from '$lib/components/exercise/RoutineGone.svelte';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import { routineTotals } from '$lib/domain/exercises';
	import { todayISO } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';

	const id = $derived(page.params.id ?? '');
	const found = $derived(tend.routine(id));
	/** A soft-deleted routine falls through to the same "gone" screen as one that never existed. */
	const routine = $derived(found?.deletedAt === null ? found : undefined);
	const home = resolve('/exercise');

	let libraryOpen = $state(false);
	let deleteOpen = $state(false);

	/** Upcoming days is what deletion actually clears; the count names the day it happens on too. */
	const upcomingDayCount = $derived(
		tend.state.trainingPlan.filter((day) => day.date >= todayISO() && day.routineIds.includes(id))
			.length
	);
	const deleteDescription = $derived(
		upcomingDayCount === 0
			? "This routine isn't scheduled on any upcoming days."
			: `This clears it from ${upcomingDayCount} upcoming ${upcomingDayCount === 1 ? 'day' : 'days'}.`
	);

	async function confirmDelete() {
		tend.removeRoutine(id);
		deleteOpen = false;
		await goto(home);
	}
</script>

<svelte:head>
	<title>Edit routine · Fit_</title>
</svelte:head>

{#if routine}
	{@const totals = routineTotals(routine)}
	<!-- "Save" only leaves: every edit below is written to the store as it is made. -->
	{#snippet save()}
		<LinkButton size="sm" class="shrink-0" href={home}>Save</LinkButton>
	{/snippet}

	<div class="flex flex-col gap-6">
		<ScreenHeader
			back="/exercise"
			backLabel="Back to Exercise"
			title="Edit routine"
			action={save}
		/>

		<section class="flex flex-col gap-2">
			<SectionLabel class="px-1">Name</SectionLabel>
			<Input
				aria-label="Routine name"
				bind:value={
					() => routine.name, (name) => tend.updateRoutine(id, { name: String(name ?? '') })
				}
				class="font-display h-14 rounded-2xl text-xl tracking-tight"
			/>
			<p class="text-muted-foreground px-1 text-sm">
				{totals.exercises} exercises · {totals.sets} sets · about {totals.minutes} min
			</p>
		</section>

		<section class="flex flex-col gap-2">
			<div class="flex items-baseline justify-between">
				<SectionLabel class="px-1">Exercises</SectionLabel>
				<span class="text-muted-foreground px-1 text-xs">tap ↑ to reorder</span>
			</div>
			{#if routine.exercises.length > 0}
				<ul class="flex flex-col gap-2">
					<!-- Keyed by the exercise object, not position: the list reorders and
					     deletes, and proxies track the object across patches, so the row
					     moves with it. Name would not do — the same movement may appear twice. -->
					{#each routine.exercises as exercise, index (exercise)}
						<BuilderExerciseRow
							{index}
							{exercise}
							onmoveup={() => tend.moveExerciseUp(id, index)}
							onremove={() => tend.removeExercise(id, index)}
							onbump={(field: 'sets' | 'reps', direction: number) =>
								tend.bumpRoutineExercise(id, index, field, direction)}
						/>
					{/each}
				</ul>
			{:else}
				<EmptyState>Nothing on this routine yet. Pick the movements it should ask for.</EmptyState>
			{/if}
			<button
				type="button"
				onclick={() => (libraryOpen = true)}
				class="border-border text-muted-foreground h-12 w-full rounded-2xl border border-dashed text-sm"
			>
				+ Add from library
			</button>
		</section>

		<Button variant="outline" onclick={() => (deleteOpen = true)}>Delete routine</Button>
	</div>

	<LibrarySheet
		bind:open={libraryOpen}
		routineName={routine.name}
		taken={routine.exercises.map((e) => e.name)}
		onadd={(names: string[]) => tend.addExercises(id, names)}
		onclose={() => (libraryOpen = false)}
	/>

	<Modal bind:open={deleteOpen} title="Delete this routine?" description={deleteDescription}>
		<div class="mt-5 flex gap-2">
			<Button variant="secondary" class="flex-1" onclick={() => (deleteOpen = false)}>Keep</Button>
			<Button class="flex-1" onclick={confirmDelete}>Delete</Button>
		</div>
	</Modal>
{:else}
	<RoutineGone title="Edit routine" />
{/if}

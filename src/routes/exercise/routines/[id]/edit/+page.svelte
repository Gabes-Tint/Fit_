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
	import Sheet from '$lib/ui/Sheet.svelte';

	const id = $derived(page.params.id ?? '');
	const found = $derived(tend.routine(id));
	/** A soft-deleted routine falls through to the same "gone" screen as one that never existed. */
	const routine = $derived(found?.deletedAt === null ? found : undefined);
	const home = resolve('/exercise');

	let libraryOpen = $state(false);
	let deleteOpen = $state(false);
	/**
	 * Filled the moment the confirm opens rather than kept reactive, so the
	 * count shown is the count `removeRoutine` — which also reads a fresh
	 * `todayISO()` — actually clears, not one computed against a day the tab
	 * was left open past.
	 */
	let deleteDescription = $state('');

	function askDelete() {
		const upcoming = tend.state.trainingPlan.filter(
			(day) => day.date >= todayISO() && day.routineIds.includes(id)
		).length;
		deleteDescription =
			upcoming === 0
				? "This routine isn't scheduled on any upcoming days."
				: `This clears it from ${upcoming} upcoming ${upcoming === 1 ? 'day' : 'days'}.`;
		deleteOpen = true;
	}

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
	<!--
		Delete sits beside Save with a wide gap between them: the two are the only
		ways out of this screen, so they belong together, and the gap is what keeps
		the irreversible one from being hit on the way to the other.
	-->
	{#snippet save()}
		<div class="flex shrink-0 items-center gap-6">
			<LinkButton size="sm" class="shrink-0" href={home}>Save</LinkButton>
			<!-- Reads "Delete" in a header that has no room for more; the label names what it deletes. -->
			<Button
				size="sm"
				variant="outline"
				class="shrink-0"
				aria-label="Delete routine"
				onclick={askDelete}>Delete</Button
			>
		</div>
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
	</div>

	<LibrarySheet
		bind:open={libraryOpen}
		routineName={routine.name}
		taken={routine.exercises.map((e) => e.name)}
		onadd={(names: string[]) => tend.addExercises(id, names)}
		onclose={() => (libraryOpen = false)}
	/>

	<Sheet bind:open={deleteOpen} title="Delete this routine?" description={deleteDescription}>
		<div class="flex gap-2 px-5 pt-3.5 pb-6">
			<Button variant="secondary" class="flex-1" onclick={() => (deleteOpen = false)}>Keep</Button>
			<Button class="flex-1" onclick={confirmDelete}>Delete</Button>
		</div>
	</Sheet>
{:else}
	<RoutineGone title="Edit routine" />
{/if}

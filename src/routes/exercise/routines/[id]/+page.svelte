<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import RoutineGone from '$lib/components/exercise/RoutineGone.svelte';
	import RoutineSheet from '$lib/components/exercise/RoutineSheet.svelte';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import { routineTotals } from '$lib/domain/exercises';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';

	const id = $derived(page.params.id ?? '');
	const found = $derived(tend.routine(id));
	/** A soft-deleted routine falls through to the same "gone" screen as one that never existed. */
	const routine = $derived(found?.deletedAt === null ? found : undefined);

	async function start() {
		if (tend.startWorkout(id)) await goto(resolve('/exercise/session'));
	}
</script>

<svelte:head>
	<title>{routine?.name ?? 'Routine'} · Fit_</title>
</svelte:head>

{#if routine}
	{@const totals = routineTotals(routine)}
	{#snippet edit()}
		<LinkButton
			variant="outline"
			size="sm"
			class="shrink-0"
			href={resolve('/exercise/routines/[id]/edit', { id })}
		>
			Edit
		</LinkButton>
	{/snippet}

	<div class="flex flex-col gap-4">
		<ScreenHeader
			back="/exercise"
			backLabel="Back to Exercise"
			title={routine.name}
			action={edit}
		/>
		<p class="text-muted-foreground -mt-2 px-1 text-sm">
			{totals.exercises} exercises · {totals.sets} sets · loads from your last session
		</p>
		<RoutineSheet
			{routine}
			onload={(index: number, direction: number) =>
				tend.bumpRoutineExercise(id, index, 'load', direction)}
		/>
		<div class="bg-background sticky bottom-0 -mx-5 mt-2 px-5 pt-3 pb-1">
			<Button class="w-full" size="lg" onclick={start}>Start this session</Button>
		</div>
	</div>
{:else}
	<RoutineGone title="Routine" />
{/if}

<script lang="ts">
	import { resolve } from '$app/paths';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import AdherenceList from '$lib/components/exercise/AdherenceList.svelte';
	import LoadTrend from '$lib/components/exercise/LoadTrend.svelte';
	import PersonalRecordList from '$lib/components/exercise/PersonalRecordList.svelte';
	import ScreenHeader from '$lib/components/exercise/ScreenHeader.svelte';
	import VolumeByGroup from '$lib/components/exercise/VolumeByGroup.svelte';
	import { countsAsTraining } from '$lib/domain/workout';
	import { tend } from '$lib/state/tend.svelte';
	import LinkButton from '$lib/ui/LinkButton.svelte';

	const home = resolve('/exercise');
	const workouts = $derived(tend.state.workouts);
	// A session walked out of with nothing ticked is still filed, so this checks
	// for one that actually trained, not just one on file.
	const trained = $derived(workouts.some(countsAsTraining));
</script>

<svelte:head>
	<title>Training · Fit_</title>
</svelte:head>

<div class="flex flex-col gap-4 pb-10">
	<ScreenHeader back="/exercise" backLabel="Back to exercise" title="Training" />

	{#if !trained}
		<EmptyState>
			No finished sessions yet, so there is nothing here to chart.
			{#snippet action()}
				<LinkButton href={home}>Back to exercise</LinkButton>
			{/snippet}
		</EmptyState>
	{:else}
		<LoadTrend {workouts} />
		<VolumeByGroup {workouts} />
		<AdherenceList {workouts} plan={tend.state.trainingPlan} />
		<PersonalRecordList {workouts} />
	{/if}
</div>

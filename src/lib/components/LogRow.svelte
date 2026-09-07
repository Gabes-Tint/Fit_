<script lang="ts">
	import { nutritionFactsForLogItem } from '$lib/domain/nutrition-facts';
	import { withVolumeHint } from '$lib/domain/portions';
	import type { LogItem } from '$lib/domain/types';
	import { tend } from '$lib/state/tend.svelte';
	import NutritionFactsButton from './NutritionFactsButton.svelte';
	import NutritionFactsSheet from './NutritionFactsSheet.svelte';
	import QuantityStepper from './QuantityStepper.svelte';
	import ProvenanceBadge from './ProvenanceBadge.svelte';

	let {
		item,
		open,
		step,
		ontoggle
	}: { item: LogItem; open: boolean; step: number; ontoggle: () => void } = $props();

	// Writes straight through to the store, which re-derives nutrition; no local copy to drift.
	function setServings(n: number) {
		tend.updateLog(item.id, { servings: n });
	}

	const portion = $derived(`${item.servings} × ${withVolumeHint(item.servingLabel)}`);

	let factsOpen = $state(false);
</script>

<li class="bg-card rounded-2xl px-3 py-2.5 shadow-border">
	<div class="flex items-center gap-1">
		<button
			type="button"
			onclick={ontoggle}
			aria-expanded={open}
			class="flex min-w-0 flex-1 items-center gap-3 text-left"
		>
			<div class="min-w-0 flex-1">
				<p class="truncate font-medium">{item.name}</p>
				<div class="mt-0.5 flex items-center gap-1.5">
					<ProvenanceBadge provenance={item.provenance} />
					<span class="text-muted-foreground truncate text-xs">{portion}</span>
				</div>
			</div>
			<span class="tabular text-muted-foreground text-sm">{item.kcal}</span>
		</button>
		<NutritionFactsButton name={item.name} onclick={() => (factsOpen = true)} />
	</div>
	{#if open}
		<div class="border-border mt-3 flex items-center justify-between border-t pt-3">
			<QuantityStepper bind:value={() => item.servings, setServings} {step} />
			<button
				type="button"
				class="text-muted-foreground hover:bg-secondary h-10 rounded-xl px-3 text-sm"
				onclick={() => tend.removeLog(item.id)}
			>
				Remove
			</button>
		</div>
	{/if}
</li>

<NutritionFactsSheet
	bind:open={factsOpen}
	name={item.name}
	servingLabel={item.servingLabel}
	rows={nutritionFactsForLogItem(item)}
/>

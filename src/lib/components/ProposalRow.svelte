<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { describeRecorded, resolveQuantity, type QuantifiedItem } from '$lib/domain/quantity';
	import { describePortion } from '$lib/domain/serving-display';
	import type { Food } from '$lib/domain/types';
	import { tend } from '$lib/state/tend.svelte';
	import FoodSearch from './FoodSearch.svelte';
	import ProvenanceBadge from './ProvenanceBadge.svelte';
	import ServingAmount from './ServingAmount.svelte';
	import ServingSizePicker from './ServingSizePicker.svelte';

	let {
		item,
		step,
		matching,
		resolved,
		onmatch,
		onpickmatch,
		onchange,
		onportion,
		onremove
	}: {
		item: QuantifiedItem;
		step: number;
		matching: boolean;
		/** The catalog food behind this proposal, once one has been matched to it. */
		resolved?: Food | undefined;
		onmatch: () => void;
		onpickmatch: (food: Food) => void;
		onchange: (next: QuantifiedItem) => void;
		/**
		 * A portion was chosen from `resolved`'s own serving list (#74's MFP
		 * follow-up). The number the person already dialled in is not this
		 * component's to touch — only the sheet holding the resolved food per
		 * proposal can rebase it without another row sharing the same catalog
		 * food changing underneath it.
		 */
		onportion: (food: Food) => void;
		onremove: () => void;
	} = $props();

	// Every food a proposal can name comes from the server catalog, so the one
	// the sheet resolved is the only one there is -- there is no bundled table
	// left to fall back to.
	const food = $derived(resolved);
	const summary = $derived(`${Math.round(item.confidence * 100)}% sure · ${item.meal}`);
	const removeLabel = $derived(`Remove ${item.name}`);
	// Re-read against the food rather than trusting a stored flag: matching an item
	// to the catalog can turn a quantity the parser had to decline into one it can use.
	const declined = $derived(item.quantity ? resolveQuantity(item.quantity, food).declined : null);
	const recorded = $derived(describeRecorded(item.servings, food, declined, tend.state.units));
	// One serving, read in the person's own system (#74): the label the source
	// gave, plus the mass it comes to when the label does not already state one.
	// The scaled total belongs to `recorded`, so it is not repeated here.
	const serving = $derived(
		describePortion(food ?? { servingLabel: 'serving' }, 1, tend.state.units)
	);
</script>

<li class="bg-background rounded-2xl p-3">
	<div class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<p class="font-medium">{item.name}</p>
			<div class="mt-1 flex flex-wrap items-center gap-1.5">
				{#if food}
					<ProvenanceBadge provenance={food.provenance} />
				{:else}
					<button type="button" onclick={onmatch} class="text-primary text-xs underline">
						Match to catalog
					</button>
				{/if}
				<span class="text-muted-foreground text-xs">{summary}</span>
			</div>
		</div>
		<button
			type="button"
			onclick={onremove}
			class="text-muted-foreground hover:bg-secondary flex size-10 items-center justify-center rounded-xl"
			aria-label={removeLabel}
		>
			<X class="size-4" />
		</button>
	</div>
	<div class="mt-2 flex items-center gap-2">
		<p class="text-muted-foreground text-xs">{serving}</p>
		{#if food}
			<ServingSizePicker {food} onchoose={onportion} />
		{/if}
	</div>
	<ServingAmount
		{food}
		servings={item.servings}
		{step}
		onchange={(n: number) => onchange({ ...item, servings: n })}
	/>
	<p class="text-muted-foreground mt-1.5 text-xs">{recorded}</p>
	{#if matching}
		<div class="mt-3">
			<FoodSearch onpick={onpickmatch} placeholder="Find a catalog match" />
		</div>
	{/if}
</li>

<script lang="ts">
	import { nutritionFactsForLogItem } from '$lib/domain/nutrition-facts';
	import { describePortion } from '$lib/domain/serving-display';
	import type { LogItem } from '$lib/domain/types';
	import { formatUnitCount } from '$lib/domain/unit-measure';
	import { tend } from '$lib/state/tend.svelte';
	import NutritionFactsButton from './NutritionFactsButton.svelte';
	import NutritionFactsSheet from './NutritionFactsSheet.svelte';
	import BrandLabel from './BrandLabel.svelte';
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

	/**
	 * "2 pieces", read off the same label the serving view shows — `null` for
	 * everything the catalog could only weigh or measure by volume (#178).
	 * Not persisted: the label already carries what is needed, so re-deriving
	 * this from it needs no new field on `LogItem` and no migration.
	 */
	const unitCount = $derived(formatUnitCount(item.servings, item.servingLabel));

	// Unit view whenever one exists (#178) — no per-food memory yet (#159), so
	// this resets to the default on every mount rather than remembering a
	// choice.
	let showUnit = $state(true);
	const unitView = $derived(unitCount !== null && showUnit ? unitCount : null);

	/**
	 * The label, plus the mass in the person's system when the label does not
	 * already state one (#74). A logged entry carries its own `grams` when it
	 * was scaled from a food that had one (#232), so a catalog result like
	 * "1 cup" gets its mass back here too; an entry with no `grams` — logged
	 * before that field existed, or scaled from a seed food that never
	 * recorded a serving weight — falls back to whatever its own label
	 * states, same as before.
	 */
	const portion = $derived(unitView ?? describePortion(item, item.servings, tend.state.units));
	const stepperStep = $derived(unitView !== null ? 1 : step);

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
				<div class="mt-0.5 flex min-w-0 items-center gap-1.5">
					<ProvenanceBadge provenance={item.provenance} />
					<!-- #337: the journal said "GREEN APPLE", "BRAND PUBLISHED" and a
						portion, and never said Claeys. A brand is what tells a candy from
						the fruit it is named after, days after the thing was logged. -->
					<BrandLabel brand={item.brand} />
					<span class="text-muted-foreground truncate text-xs">{portion}</span>
				</div>
			</div>
			<span class="tabular text-muted-foreground text-sm">{item.kcal}</span>
		</button>
		<NutritionFactsButton name={item.name} onclick={() => (factsOpen = true)} />
	</div>
	{#if open}
		<div class="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
			<QuantityStepper bind:value={() => item.servings, setServings} step={stepperStep} />
			<div class="flex items-center gap-1">
				{#if unitCount !== null}
					<button
						type="button"
						onclick={() => (showUnit = !showUnit)}
						aria-label={showUnit ? 'Show weight' : 'Show unit count'}
						class="text-muted-foreground hover:bg-secondary h-10 rounded-xl px-2 text-sm"
					>
						{showUnit ? 'Weight' : 'Unit'}
					</button>
				{/if}
				<button
					type="button"
					class="text-muted-foreground hover:bg-secondary h-10 rounded-xl px-3 text-sm"
					onclick={() => tend.removeLog(item.id)}
				>
					Remove
				</button>
			</div>
		</div>
	{/if}
</li>

<NutritionFactsSheet
	bind:open={factsOpen}
	name={item.name}
	servingLabel={describePortion(item, item.servings, tend.state.units)}
	rows={nutritionFactsForLogItem(item)}
/>

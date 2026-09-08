<script lang="ts">
	import { canRePortion, foodAtPortion } from '$lib/domain/serving-choice';
	import type { Food } from '$lib/domain/types';
	import Sheet from '$lib/ui/Sheet.svelte';

	/**
	 * MyFitnessPal's second Add Food control (the brief that opened issue #74's
	 * successors): beside the amount, a tappable serving size that opens the
	 * food's own portion list -- "4.0 oz", "1.0 medium breast", "100 g".
	 * `ServingAmount` already owns the amount; this owns *which* serving that
	 * amount multiplies, and hands the re-based food to `foodAtPortion` rather
	 * than doing any arithmetic itself (`serving-choice.ts` explains why that
	 * matters -- everything downstream keeps working unchanged only if nothing
	 * here invents its own conversion).
	 *
	 * Kept as its own file rather than folded into `ProposalRow`: the "does
	 * this food even have a choice to offer" question -- true of most seeded
	 * foods, most recipes, and any catalog food whose rows were all rejected as
	 * implausible (`serving-options.ts`) -- is answered once here, by rendering
	 * nothing, rather than as a conditional buried inside a row that already
	 * has several. A caller that never checks `canRePortion` still cannot show
	 * a broken picker; there is nothing to show.
	 */
	let {
		food,
		onchoose
	}: {
		/** The resolved catalog food a portion would be chosen for. */
		food: Food;
		/** Called with the food re-based onto the picked portion. */
		onchoose: (food: Food) => void;
	} = $props();

	let open = $state(false);

	function isCurrent(option: { label: string; grams: number }): boolean {
		return option.label === food.servingLabel && option.grams === food.grams;
	}

	// `canRePortion` narrows `food` to a `PortionedFood` only inside the branch
	// that calls it, so this is re-checked here rather than trusted from the
	// markup below -- a plain `Food` reaching this function is a type error,
	// not a runtime guard someone could forget.
	function pick(option: { label: string; grams: number }) {
		if (!canRePortion(food)) return;
		onchoose(foodAtPortion(food, option));
		open = false;
	}
</script>

{#if canRePortion(food) && food.servingOptions && food.servingOptions.length > 0}
	<button
		type="button"
		onclick={() => (open = true)}
		aria-label={`Serving size for ${food.name}`}
		class="border-border text-muted-foreground hover:bg-secondary h-7 shrink-0 rounded-full border px-2.5 text-xs"
	>
		{food.servingLabel}
	</button>

	<Sheet bind:open title={`Serving size for ${food.name}`} onclose={() => (open = false)}>
		<ul class="flex flex-col gap-1 overflow-y-auto px-5 pt-2 pb-5">
			{#each food.servingOptions as option (option.label + option.grams)}
				<li>
					<button
						type="button"
						onclick={() => pick(option)}
						aria-pressed={isCurrent(option)}
						class={[
							'hover:bg-secondary flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm',
							isCurrent(option) && 'bg-secondary font-medium'
						]}
					>
						{option.label}
					</button>
				</li>
			{/each}
		</ul>
	</Sheet>
{/if}

<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import { onDestroy } from 'svelte';
	import { createFoodSearch, MIN_QUERY_LENGTH } from '$lib/catalog/food-search.svelte';
	import { nutritionFactsForFood } from '$lib/domain/nutrition-facts';
	import { describePortion } from '$lib/domain/serving-display';
	import type { Food } from '$lib/domain/types';
	import { tend } from '$lib/state/tend.svelte';
	import Input from '$lib/ui/Input.svelte';
	import NutritionFactsButton from './NutritionFactsButton.svelte';
	import NutritionFactsSheet from './NutritionFactsSheet.svelte';
	import BrandLabel from './BrandLabel.svelte';

	let {
		onpick,
		ondirectlog,
		placeholder = 'Search foods, brands, barcodes'
	}: {
		onpick: (food: Food) => void;
		/**
		 * The `+` on a result row, for logging it straight away with no proposal
		 * in between. Optional because `ProposalRow` also mounts this component
		 * to find a catalog match for an already-typed item -- there, tapping a
		 * row is meant to resolve that item, not create a second, unrelated log
		 * entry, so it leaves this unset and the button never appears.
		 */
		ondirectlog?: (food: Food) => void;
		placeholder?: string;
	} = $props();

	/** Named once: it is in every line this component has to say about the network. */
	const FULL = 'the full catalog';

	let query = $state('');
	const search = createFoodSearch();

	/**
	 * The catalog's ranked rows, and nothing else.
	 *
	 * Until #146 a hand-written table of forty-nine foods was listed above them,
	 * so the box always had something to show. It is gone: it was the last thing
	 * in the app that answered a search without the server, it could only ever
	 * answer for the sample journal's own ingredients, and a list that quietly
	 * falls back to it is a list that hides being offline. What replaces it is
	 * `notice` saying so in words.
	 */
	const results = $derived(search.outcome?.kind === 'matched' ? search.outcome.foods : []);

	/**
	 * One line about the catalog. There is always something to say now.
	 *
	 * A search that could not run must never read like a search that found
	 * nothing: no connection, no catalog on the server and no session are all
	 * worth acting on, and none of them means the food does not exist. With no
	 * bundled rows left to list underneath, this line is the only thing standing
	 * between an unreachable catalog and an empty list that looks like an answer
	 * — so it says plainly that searching needs the server, before it is asked
	 * to as well as after.
	 */
	const notice = $derived.by(() => {
		if (search.searching) return `Searching ${FULL}…`;
		const kind = search.outcome?.kind;
		if (kind === 'signed-out') return `Sign in to search ${FULL}. Search has nothing else to ask.`;
		if (kind === 'unreachable')
			return `Search needs a connection, and ${FULL} is out of reach right now. Try again in a moment.`;
		if (kind === 'none') return `Nothing in ${FULL} matches that.`;
		const typedSoFar = query.trim().length;
		if (typedSoFar === 0) return `Every food comes from ${FULL}, so searching needs a connection.`;
		if (typedSoFar < MIN_QUERY_LENGTH)
			return `Keep typing: ${FULL} is searched from three letters.`;
		return '';
	});

	/**
	 * The follow-on under an empty list, and only when the catalog actually
	 * answered. Offering "log it as custom" to someone who is offline would be
	 * telling them the food does not exist, which nothing here knows.
	 *
	 * It used to say "You can still log it as custom from text.", which was
	 * never true: the Type tab's unmatched proposals are exactly what
	 * `commit()` (LogSheet.svelte) throws away, with a toast telling the
	 * person to match each one to a catalog food first. There is no custom-food
	 * path today, so this says what is actually still available -- another
	 * spelling, or the barcode, which is its own search that does not depend
	 * on getting the name right.
	 */
	const custom = $derived(
		search.outcome?.kind === 'none' ? 'Try a different spelling, or scan the barcode instead.' : ''
	);

	function typed(value: string) {
		query = value;
		search.ask(value);
	}

	/** The result the nutrition facts sheet was last opened for, and whether it is open. */
	let factsFor = $state<Food | null>(null);
	let factsOpen = $state(false);

	function showFacts(food: Food) {
		factsFor = food;
		factsOpen = true;
	}

	// The panel is opened and closed inside a proposal row, so a pending request
	// has to go with it rather than answering into a component that has left.
	onDestroy(search.stop);
</script>

<div class="flex flex-col gap-3">
	<div class="relative">
		<Search
			class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
		/>
		<Input bind:value={() => query, typed} {placeholder} class="pl-9" aria-label={placeholder} />
	</div>
	{#if notice}
		<p class="text-muted-foreground px-1 text-xs">{notice}</p>
	{/if}
	<ul class="flex flex-col gap-1">
		{#each results as food (food.id)}
			{@const serving = describePortion(food, 1, tend.state.units)}
			{@const summary = `${serving} · ${food.kcal} kcal · ${food.protein}g protein`}
			<li class="bg-background hover:bg-secondary flex flex-col rounded-2xl pr-1 transition-colors">
				<!-- The name is the whole first line. ⓘ and + sit on the brand
					line so a long USDA title is no longer truncated by those
					controls. The serving numbers stay last (#337). -->
				<button
					type="button"
					onclick={() => onpick(food)}
					class="min-w-0 w-full px-3 pt-3 pb-0.5 text-left"
				>
					<p class="min-w-0 truncate font-medium">{food.name}</p>
				</button>
				<div class="flex min-w-0 items-center gap-1 pl-3">
					{#if food.brand?.trim()}
						<button
							type="button"
							onclick={() => onpick(food)}
							class="min-w-0 flex-1 py-0.5 text-left"
						>
							<BrandLabel brand={food.brand} />
						</button>
					{:else}
						<span class="min-w-0 flex-1"></span>
					{/if}
					<NutritionFactsButton name={food.name} onclick={() => showFacts(food)} />
					{#if ondirectlog}
						<button
							type="button"
							onclick={() => ondirectlog(food)}
							aria-label={`Log ${food.name}`}
							class="text-muted-foreground hover:bg-secondary flex size-10 shrink-0 items-center justify-center rounded-xl"
						>
							<Plus class="size-4" />
						</button>
					{/if}
				</div>
				<button
					type="button"
					onclick={() => onpick(food)}
					class="min-w-0 w-full px-3 pt-0.5 pb-3 text-left"
				>
					<p class="text-muted-foreground truncate text-xs">{summary}</p>
				</button>
			</li>
		{/each}
	</ul>
	{#if custom}
		<p class="text-muted-foreground px-2 pb-2 text-center text-sm">{custom}</p>
	{/if}
</div>

{#if factsFor}
	<NutritionFactsSheet
		bind:open={factsOpen}
		name={factsFor.name}
		servingLabel={describePortion(factsFor, 1, tend.state.units)}
		rows={nutritionFactsForFood(factsFor)}
	/>
{/if}

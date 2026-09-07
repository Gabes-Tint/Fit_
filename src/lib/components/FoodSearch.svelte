<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import { onDestroy } from 'svelte';
	import { createFoodSearch, MIN_QUERY_LENGTH } from '$lib/catalog/food-search.svelte';
	import { findFoods } from '$lib/domain/food-match';
	import { FOODS } from '$lib/domain/foods';
	import type { Food } from '$lib/domain/types';
	import Input from '$lib/ui/Input.svelte';
	import ProvenanceBadge from './ProvenanceBadge.svelte';

	let {
		onpick,
		placeholder = 'Search foods, brands, barcodes'
	}: { onpick: (food: Food) => void; placeholder?: string } = $props();

	/** Named once: it is in every line this component has to say about the network. */
	const FULL = 'the full catalog';

	let query = $state('');
	const search = createFoodSearch();

	/**
	 * The bundled foods first, then the catalog's ranked rows.
	 *
	 * The bundled foods stay. They are hand-written, they carry stable ids that
	 * log against `foodId`, and they are the only thing that answers with no
	 * connection — the flow issue #34 asks for by name. Since #116 they are the
	 * foods the sample journal and the recipe book are built from and nothing
	 * else, because the typed parser that used to need the other forty-seven now
	 * asks the server. Five of them rather than twenty, so a fuzzy local match
	 * cannot push the catalog's ranking off the screen.
	 *
	 * The catalog's rows are appended rather than substituted, which is what
	 * keeps the list from flashing: whatever was on screen when the request went
	 * out is still there, in the same order, when the answer lands.
	 */
	const results = $derived.by(() => {
		if (!query.trim()) return FOODS.slice(0, 20);
		// A barcode is an exact match; check it before falling back to fuzzy search.
		const barcode = query.replace(/\s/g, '');
		if (/^\d{8,14}$/.test(barcode)) {
			const hit = FOODS.find((f) => f.barcode === barcode);
			if (hit) return [hit];
		}
		const catalog = search.outcome?.kind === 'matched' ? search.outcome.foods : [];
		return [...findFoods(query, 5).map((r) => r.food), ...catalog];
	});

	/**
	 * One line about the catalog whenever there is something to say.
	 *
	 * A search that could not run must never read like a search that found
	 * nothing: no connection, no catalog on the server and no session are all
	 * worth acting on, and none of them means the food does not exist. The
	 * bundled rows are still listed underneath in every one of those cases, so
	 * the box is never both empty and silent.
	 */
	const notice = $derived.by(() => {
		if (search.searching) return `Searching ${FULL}…`;
		const kind = search.outcome?.kind;
		if (kind === 'signed-out') return `Sign in to search ${FULL}. Only the bundled foods answer.`;
		if (kind === 'unreachable') return `Only the bundled foods answer — ${FULL} is out of reach.`;
		if (kind === 'none') return `Nothing else in ${FULL} matches that.`;
		const typedSoFar = query.trim().length;
		if (typedSoFar > 0 && typedSoFar < MIN_QUERY_LENGTH)
			return `Keep typing: ${FULL} is searched from three letters.`;
		return '';
	});

	function typed(value: string) {
		query = value;
		search.ask(value);
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
			{@const summary = `${food.brand ? `${food.brand} · ` : ''}${food.servingLabel} · ${food.kcal} kcal · ${food.protein}g protein`}
			<li>
				<button
					type="button"
					onclick={() => onpick(food)}
					class="bg-background hover:bg-secondary flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors"
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<p class="min-w-0 truncate font-medium">{food.name}</p>
							<span class="shrink-0">
								<ProvenanceBadge provenance={food.provenance} />
							</span>
						</div>
						<p class="text-muted-foreground truncate text-xs">{summary}</p>
					</div>
				</button>
			</li>
		{:else}
			<li class="text-muted-foreground px-2 py-6 text-center text-sm">
				Nothing in the catalog for that yet. You can still log it as custom from text.
			</li>
		{/each}
	</ul>
</div>

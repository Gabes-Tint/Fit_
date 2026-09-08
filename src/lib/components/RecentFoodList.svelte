<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { relogItem } from '$lib/domain/log-entry';
	import {
		mostFrequentFoods,
		mostRecentFoods,
		recentFoodSources,
		type RecentFood
	} from '$lib/domain/recent-foods';
	import type { Meal } from '$lib/domain/types';
	import { todayISO } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';

	/** Which meal a tap logs into -- the one already selected in the sheet's meal row. */
	let { meal }: { meal: Meal } = $props();

	type Order = 'recent' | 'frequent';
	let order = $state<Order>('recent');

	// Reads straight off the store rather than a prop: this is the one part of
	// the log flow that has to work with `FoodSearch` mid-air over a dead
	// connection, and a prop would still have to come from the same place.
	const log = $derived(tend.profile?.log ?? []);
	const foods = $derived(order === 'recent' ? mostRecentFoods(log) : mostFrequentFoods(log));
	// Keyed by the same `key` `foods` uses, so a tap can find the real entry
	// behind the summary row without re-deriving "which one was that" -- see
	// `recentFoodSources`'s own doc comment for why that would be a mistake.
	const sources = $derived(recentFoodSources(log));

	function logRecent(food: RecentFood) {
		const source = sources.get(food.key);
		// Can't happen in practice: `food` was built from the same `log` this
		// just re-grouped, so its key is always in `sources` too. Guarded anyway
		// rather than logging nothing useful if that ever stops being true.
		if (!source) return;
		const item = relogItem(source, { date: todayISO(), meal, servings: food.lastServings });
		tend.addLogItems([item]);
		toast(`Logged ${food.name} to ${meal}.`, {
			action: { label: 'Undo', onClick: () => tend.removeLog(item.id) }
		});
	}
</script>

<div class="mb-4 flex flex-col gap-2">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-muted-foreground text-xs font-medium">History</h3>
		<div class="flex gap-1">
			<ToggleButton
				pressed={order === 'recent'}
				onclick={() => (order = 'recent')}
				resting="bg-secondary text-muted-foreground"
				class="h-7 rounded-full px-3 text-xs"
			>
				Recent
			</ToggleButton>
			<ToggleButton
				pressed={order === 'frequent'}
				onclick={() => (order = 'frequent')}
				resting="bg-secondary text-muted-foreground"
				class="h-7 rounded-full px-3 text-xs"
			>
				Often
			</ToggleButton>
		</div>
	</div>
	{#if foods.length === 0}
		<p class="text-muted-foreground px-1 text-xs">
			Nothing here yet. Log a few meals and they’ll turn up here for a one-tap repeat.
		</p>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each foods as food (food.key)}
				{@const summary = `${food.brand ? `${food.brand} · ` : ''}${food.servingLabel} · ${food.kcalPerServing} kcal`}
				<li>
					<button
						type="button"
						onclick={() => logRecent(food)}
						class="bg-background hover:bg-secondary flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left"
					>
						<div class="min-w-0 flex-1">
							<p class="min-w-0 truncate font-medium">{food.name}</p>
							<p class="text-muted-foreground truncate text-xs">{summary}</p>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

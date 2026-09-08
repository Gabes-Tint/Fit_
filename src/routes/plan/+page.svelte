<script lang="ts">
	import { SEED_FOOD_BY_ID } from '$lib/domain/foods';
	import { buildGrocery, type GroceryItem } from '$lib/domain/grocery';
	import { logFromFood } from '$lib/domain/log-entry';
	import { RECIPE_BY_ID, recipeMacros } from '$lib/domain/recipes';
	import type { PlannedMealSlot } from '$lib/domain/types';
	import { PLANNED_MEALS } from '$lib/domain/types';
	import { addDaysISO, startOfWeek, todayISO, weekdayShort } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	let tab = $state<'meals' | 'grocery'>('meals');

	const today = todayISO();
	const days = Array.from({ length: 7 }, (_, i) => addDaysISO(startOfWeek(today), i));

	const plan = $derived(tend.state.weekPlan);
	const grocery = $derived(buildGrocery(plan, tend.state.pantry));
	const profiles = $derived(tend.state.profiles);
	const restrictions = $derived([...new Set(profiles.flatMap((p) => p.restrictions))]);

	// Consecutive runs suffice: buildGrocery already sorts by aisle.
	const aisles = $derived.by(() => {
		const out: { aisle: string; items: GroceryItem[] }[] = [];
		for (const item of grocery) {
			const last = out.at(-1);
			if (last?.aisle === item.aisle) last.items.push(item);
			else out.push({ aisle: item.aisle, items: [item] });
		}
		return out;
	});

	function logRecipe(recipeId: string, date: string, meal: PlannedMealSlot) {
		const recipe = RECIPE_BY_ID[recipeId];
		if (!recipe) return;
		const items = recipe.ingredients
			.filter((ing) => SEED_FOOD_BY_ID[ing.foodId])
			.map((ing) =>
				logFromFood({
					foodId: ing.foodId,
					servings: ing.servings / recipe.servings,
					meal,
					date,
					source: 'plan'
				})
			);
		tend.addLogItems(items);
		toast(`Logged ${recipe.name}.`);
	}
</script>

<svelte:head>
	<title>Plan · Fit_</title>
</svelte:head>

<div class="flex flex-col gap-5 pb-10">
	<PageHeader kicker="This week" title="Plan">
		Meals and groceries for the week{restrictions.length
			? ` · honors ${restrictions.join(', ')}`
			: ''}.
	</PageHeader>

	<div class="bg-card flex gap-1 rounded-2xl p-1">
		{#each ['meals', 'grocery'] as const as t (t)}
			<ToggleButton
				pressed={tab === t}
				onclick={() => (tab = t)}
				resting="text-muted-foreground"
				class="h-10 flex-1 rounded-xl text-sm capitalize"
			>
				{t}
			</ToggleButton>
		{/each}
	</div>

	{#if tab === 'meals'}
		<Button variant="secondary" onclick={() => tend.generatePlan()}>Rebuild this week</Button>
		<div class="flex flex-col gap-4">
			{#each days as date (date)}
				<section class="bg-card rounded-3xl p-4 shadow-border">
					<h2 class="font-display text-lg tracking-tight">
						{date === today ? 'Today' : weekdayShort(date)}
					</h2>
					<ul class="mt-3 flex flex-col gap-3">
						{#each PLANNED_MEALS as meal (meal)}
							{@const slot = plan.find((p) => p.date === date && p.meal === meal)}
							{@const recipe = slot ? RECIPE_BY_ID[slot.recipeId] : undefined}
							<li class="bg-background rounded-2xl p-3">
								<p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
									{meal}
								</p>
								<p class="mt-0.5 font-medium">{recipe?.name ?? '—'}</p>
								{#if recipe}
									{@const macros = recipeMacros(recipe)}
									<p class="text-muted-foreground text-xs">
										{macros.kcal} kcal · {macros.protein}g protein · {macros.fiber}g fiber
									</p>
								{/if}
								<div class="mt-2 flex gap-2">
									<Button
										size="sm"
										variant="secondary"
										onclick={() => tend.swapPlanned(date, meal)}
									>
										Swap
									</Button>
									{#if recipe}
										<Button
											size="sm"
											variant="ghost"
											onclick={() => logRecipe(recipe.id, date, meal)}
										>
											Log it
										</Button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-5">
			{#each aisles as group (group.aisle)}
				<section>
					<h2 class="font-display mb-2 text-xl tracking-tight">{group.aisle}</h2>
					<ul class="flex flex-col gap-1">
						{#each group.items as item (item.foodId)}
							<li class="bg-card flex items-center gap-3 rounded-2xl px-3 py-3">
								<Checkbox
									checked={item.inPantry}
									onCheckedChange={() => tend.togglePantry(item.foodId)}
									aria-label="{item.name} already in pantry"
								/>
								<div class="min-w-0 flex-1 {item.inPantry ? 'opacity-50' : ''}">
									<p class="font-medium">{item.name}</p>
									<p class="text-muted-foreground text-xs">
										{item.servings} × {item.servingLabel}
									</p>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>

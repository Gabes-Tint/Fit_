<script lang="ts">
	import Dumbbell from '@lucide/svelte/icons/dumbbell';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Weight from '@lucide/svelte/icons/weight';
	import {
		dayStripAccessibleLabel,
		dayStripLabel,
		dayStripRange,
		loggedMarksText
	} from '$lib/domain/week-strip';
	import { todayISO } from '$lib/domain/utils';
	import { cn } from '$lib/ui/cn';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';

	let {
		food,
		exercise,
		weight,
		selected = $bindable()
	}: {
		food: Set<string>;
		exercise: Set<string>;
		weight: Set<string>;
		selected: string;
	} = $props();

	const today = todayISO();
	const days = dayStripRange(today);

	let todayEl = $state<HTMLButtonElement>();
	let pillEls: (HTMLButtonElement | undefined)[] = [];

	$effect(() => {
		todayEl?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
	});

	/** Roving tabindex: arrow keys move focus among pills without changing selection. */
	function handlePillKeydown(index: number, event: KeyboardEvent) {
		const target =
			event.key === 'ArrowLeft'
				? index - 1
				: event.key === 'ArrowRight'
					? index + 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? days.length - 1
							: undefined;
		if (target === undefined || target < 0 || target >= days.length) return;
		event.preventDefault();
		pillEls[target]?.focus();
		pillEls[target]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
	}

	function markClass(isSelected: boolean, has: boolean) {
		return cn(
			has
				? isSelected
					? 'text-primary-foreground'
					: 'text-primary'
				: isSelected
					? 'text-primary-foreground/30'
					: 'text-muted-foreground/50'
		);
	}
</script>

<div class="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto px-[calc(50%-2.5rem)]">
	{#each days as iso, i (iso)}
		{@const isSelected = iso === selected}
		{@const isToday = iso === today}
		{@const hasFood = food.has(iso)}
		{@const hasExercise = exercise.has(iso)}
		{@const hasWeight = weight.has(iso)}
		<ToggleButton
			pressed={isSelected}
			onclick={() => (selected = iso)}
			onkeydown={(event: KeyboardEvent) => handlePillKeydown(i, event)}
			tabindex={isSelected ? 0 : -1}
			resting="bg-card text-foreground"
			aria-label={dayStripAccessibleLabel(
				iso,
				loggedMarksText(hasFood, hasExercise, hasWeight),
				isToday
			)}
			class={cn(
				'relative flex h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 snap-center transition-colors duration-150',
				isToday && !isSelected && 'ring-1 ring-primary ring-inset'
			)}
			{@attach (el: HTMLButtonElement) => {
				pillEls[i] = el;
				if (iso === today) todayEl = el;
			}}
		>
			<span class={cn('text-xs', isSelected ? 'opacity-80' : 'text-muted-foreground')}>
				{dayStripLabel(iso)}
			</span>
			<span class="flex items-center gap-1.5">
				<Utensils
					aria-hidden="true"
					size={16}
					stroke-width={2.25}
					class={cn('size-4 shrink-0', markClass(isSelected, hasFood))}
				/>
				<Dumbbell
					aria-hidden="true"
					size={16}
					stroke-width={2.25}
					class={cn('size-4 shrink-0', markClass(isSelected, hasExercise))}
				/>
				<Weight
					aria-hidden="true"
					size={16}
					stroke-width={2.25}
					class={cn('size-4 shrink-0', markClass(isSelected, hasWeight))}
				/>
			</span>
		</ToggleButton>
	{/each}
</div>

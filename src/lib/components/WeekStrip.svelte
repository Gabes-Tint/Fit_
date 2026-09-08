<script lang="ts">
	import Dumbbell from '@lucide/svelte/icons/dumbbell';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Weight from '@lucide/svelte/icons/weight';
	import DayStrip from '$lib/components/DayStrip.svelte';
	import { DAY_STRIP_CELL } from '$lib/components/day-strip';
	import { dayStripAccessibleLabel, dayStripLabel, loggedMarksText } from '$lib/domain/week-strip';
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

<DayStrip>
	{#snippet children({
		iso,
		isToday,
		attach,
		onkeydown
	}: {
		iso: string;
		isToday: boolean;
		attach: (el: HTMLElement) => void;
		onkeydown: (event: KeyboardEvent) => void;
	})}
		{@const isSelected = iso === selected}
		{@const hasFood = food.has(iso)}
		{@const hasExercise = exercise.has(iso)}
		{@const hasWeight = weight.has(iso)}
		<ToggleButton
			pressed={isSelected}
			onclick={() => (selected = iso)}
			{onkeydown}
			tabindex={isSelected ? 0 : -1}
			resting="bg-card text-foreground"
			aria-label={dayStripAccessibleLabel(
				iso,
				loggedMarksText(hasFood, hasExercise, hasWeight),
				isToday
			)}
			class={cn(
				DAY_STRIP_CELL,
				'relative px-2 transition-colors duration-150',
				isToday && !isSelected && 'ring-1 ring-primary ring-inset'
			)}
			{@attach attach}
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
	{/snippet}
</DayStrip>

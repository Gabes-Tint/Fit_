<script lang="ts">
	import type { Snippet } from 'svelte';
	import { dayStripRange } from '$lib/domain/week-strip';
	import { todayISO } from '$lib/domain/utils';

	/**
	 * What one cell's snippet receives: the day itself, plus the wiring it
	 * must attach to its own interactive element (button or link).
	 */
	type CellProps = {
		iso: string;
		isToday: boolean;
		attach: (el: HTMLElement) => void;
		onkeydown: (event: KeyboardEvent) => void;
	};

	/**
	 * The scrollable 38-day shell behind both the home strip and the exercise
	 * strip: the day range, the snap-scrolling container, auto-centering on
	 * today at mount, and roving-tabindex Arrow/Home/End keyboard nav. Each
	 * cell's contents and its own interactive element (a button that selects
	 * a day, a link that always goes to the planner) are supplied by the
	 * caller through `children`, since that is the only part the two strips
	 * do not share.
	 */
	let {
		today = todayISO(),
		days = dayStripRange(today),
		children
	}: {
		today?: string;
		days?: string[];
		children: Snippet<[CellProps]>;
	} = $props();

	let todayEl = $state<HTMLElement>();
	let cellEls: (HTMLElement | undefined)[] = [];

	$effect(() => {
		todayEl?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
	});

	/** Roving tabindex: arrow keys move focus among cells without changing selection. */
	function handleKeydown(index: number, event: KeyboardEvent) {
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
		cellEls[target]?.focus();
		cellEls[target]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
	}
</script>

<div class="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto px-[calc(50%-2.5rem)]">
	{#each days as iso, i (iso)}
		{@render children({
			iso,
			isToday: iso === today,
			attach: (el: HTMLElement) => {
				cellEls[i] = el;
				if (iso === today) todayEl = el;
			},
			onkeydown: (event: KeyboardEvent) => handleKeydown(i, event)
		})}
	{/each}
</div>

<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	/**
	 * The back control is a link, not `history.back()`, so arriving from a deep
	 * link still leads somewhere sensible.
	 */
	let {
		back,
		backLabel = 'Back',
		title,
		action
	}: {
		/** The route to return to, resolved here so callers pass the id they mean. */
		back: '/exercise' | '/exercise/plan';
		backLabel?: string;
		title: string;
		action?: Snippet | undefined;
	} = $props();

	const href = $derived(resolve(back));
</script>

<div class="-mx-1 flex h-12 items-center gap-1">
	<a
		{href}
		aria-label={backLabel}
		class="text-foreground hover:bg-secondary flex size-10 items-center justify-center rounded-xl"
	>
		<ChevronLeft class="size-5" />
	</a>
	<span class="font-display min-w-0 flex-1 truncate text-xl tracking-tight">{title}</span>
	{#if action}
		{@render action()}
	{/if}
</div>

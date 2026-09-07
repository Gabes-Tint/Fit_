<script lang="ts">
	import Info from '@lucide/svelte/icons/info';

	/**
	 * The ⓘ on a `FoodSearch` result row and a `LogRow` (#175), factored out of
	 * both: the two rows are otherwise unrelated, and duplicating this button's
	 * markup between them would duplicate its bundle weight too.
	 */
	let { name, onclick }: { name: string; onclick: () => void } = $props();
</script>

<button
	type="button"
	onclick={(event) => {
		event.stopPropagation();
		onclick();
	}}
	aria-label={`Nutrition facts for ${name}`}
	class="text-muted-foreground hover:bg-secondary focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
>
	<Info class="size-4" />
</button>

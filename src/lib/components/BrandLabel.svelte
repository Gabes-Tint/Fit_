<script lang="ts">
	/**
	 * The brand a food is sold under, beside its source badge.
	 *
	 * #337: a person logged Claeys hard candy as "GREEN APPLE" at 400 kcal,
	 * because the row said the food's name and where the numbers came from but
	 * never said whose product it was. The badge answers "who published this",
	 * which is not the question a candy named after a fruit makes urgent — "what
	 * am I about to log" is, and the brand is the word that answers it.
	 *
	 * Its own file, and used by both rows, so the search result a person taps and
	 * the journal row they read afterwards cannot say different things about the
	 * same food. Nothing at all when the food has no brand: most of the catalog
	 * is generic, and an empty slot on every one of those rows would be noise.
	 */
	let { brand }: { brand?: string | undefined } = $props();

	// A brand of spaces is a brand the ETL carried through as blank text, and it
	// would render as an empty grey gap rather than as a name.
	const shown = $derived(brand?.trim() ?? '');
</script>

{#if shown}
	<span class="text-muted-foreground min-w-0 truncate text-xs font-medium tracking-wide uppercase">
		{shown}
	</span>
{/if}

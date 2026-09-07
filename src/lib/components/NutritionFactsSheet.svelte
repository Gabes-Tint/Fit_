<script lang="ts">
	import type { NutritionFactRow } from '$lib/domain/nutrition-facts';
	import Sheet from '$lib/ui/Sheet.svelte';

	/** A value the catalog never reported, shown as an em dash rather than a false zero. */
	const GAP = '—';

	let {
		open = $bindable(false),
		name,
		servingLabel,
		rows
	}: {
		open?: boolean;
		name: string;
		servingLabel: string;
		rows: NutritionFactRow[];
	} = $props();
</script>

<Sheet bind:open title={name} description={servingLabel} onclose={() => (open = false)}>
	<div class="overflow-y-auto px-5 pb-6">
		<table class="w-full text-sm">
			<tbody>
				{#each rows as row (row.key)}
					<tr class="border-border border-b last:border-none">
						<td class="text-muted-foreground py-2 pr-3">{row.label}</td>
						<td class="tabular py-2 text-right font-medium">
							{row.value === null ? GAP : `${row.value} ${row.unit}`}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Sheet>

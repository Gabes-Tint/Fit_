<script lang="ts">
	import { weightToKg, weightUnitAbbr, weightUnitName } from '$lib/domain/units';
	import { addDaysISO, todayISO } from '$lib/domain/utils';
	import type { UnitSystem } from '$lib/domain/types';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';

	let { units }: { units: UnitSystem } = $props();

	let enteredWeight = $state('');

	const weightAbbr = $derived(weightUnitAbbr(units));
	const weightName = $derived(weightUnitName(units));
	const weightPlaceholder = $derived(`Weight in ${weightAbbr}`);
	const weightAriaLabel = $derived(`Weight in ${weightName}`);

	function saveFor(daysAgo: 0 | 1 | 2) {
		const n = Number(enteredWeight);
		if (!(n > 0)) return;
		tend.addWeight(weightToKg(n, units), addDaysISO(todayISO(), -daysAgo));
		enteredWeight = '';
	}

	function saveWeight(event: SubmitEvent) {
		event.preventDefault();
		saveFor(0);
	}
</script>

<form class="flex flex-col gap-2" onsubmit={saveWeight}>
	<Input
		id="weight"
		inputmode="decimal"
		placeholder={weightPlaceholder}
		aria-label={weightAriaLabel}
		bind:value={enteredWeight}
	/>
	<div class="flex gap-2">
		<Button type="button" variant="secondary" class="flex-1" onclick={() => saveFor(2)}>
			2 days ago
		</Button>
		<Button type="button" variant="secondary" class="flex-1" onclick={() => saveFor(1)}>
			Yesterday
		</Button>
		<Button type="submit" class="flex-1">Today</Button>
	</div>
</form>

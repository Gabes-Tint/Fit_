<script lang="ts">
	import type { Food } from '$lib/domain/types';
	import ServingAmount from './ServingAmount.svelte';

	/**
	 * The log sheet owns the amount and hands it back down; this stands in for
	 * it, so a test can tap the stepper twice, or type and then step, and read
	 * what a person would actually be looking at afterwards. A props-only
	 * render would answer every tap from the first value.
	 */
	let { food, servings, step }: { food?: Food | undefined; servings: number; step: number } =
		$props();

	/** Nothing until the control reports a change; the prop is the amount until then. */
	let changed = $state<number | null>(null);
	const current = $derived(changed ?? servings);
</script>

<ServingAmount {food} servings={current} {step} onchange={(next: number) => (changed = next)} />
<p data-testid="amount">{current}</p>

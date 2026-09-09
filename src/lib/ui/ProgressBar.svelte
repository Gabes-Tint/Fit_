<script lang="ts">
	import { cn } from '$lib/ui/cn';

	/** Decorative: the reading beside it carries the value, so it stays out of the accessibility tree. */
	let {
		value,
		target,
		barClass = 'bg-primary',
		class: className
	}: { value: number; target: number; barClass?: string; class?: string | undefined } = $props();

	// A target of zero would divide by zero; an empty bar is the honest answer.
	const pct = $derived(target > 0 ? Math.min(100, (value / target) * 100) : 0);
	const barStyle = $derived(`width: ${pct}%`);
</script>

<div aria-hidden="true" class={cn('bg-secondary h-1.5 overflow-hidden rounded-full', className)}>
	<div class={cn('h-full rounded-full', barClass)} style={barStyle}></div>
</div>

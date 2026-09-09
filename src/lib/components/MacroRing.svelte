<script lang="ts">
	import { cn } from '$lib/ui/cn';

	/**
	 * One progress ring: a muted `--color-secondary` track circle plus a
	 * clockwise-from-top `--color-primary` arc on top of it. Used to be a
	 * wrapper around a shared `RingArc` component, but once `GlpRingCluster`
	 * (the only other consumer, three nested `RingArc`s sharing one `<svg>`)
	 * was retired for the one-ring layout, this was the sole remaining
	 * consumer — so the arc math moved back in here rather than keeping a
	 * one-caller indirection alive.
	 */
	let {
		value,
		target,
		label = '',
		unit,
		size = 132,
		emphasis = false
	}: {
		value: number;
		target: number;
		label?: string;
		unit: string;
		size?: number;
		emphasis?: boolean;
	} = $props();

	const stroke = $derived(emphasis ? 10 : 8);
	const radius = $derived((size - stroke - 4) / 2);
	const ratio = $derived(target > 0 ? Math.min(value / target, 1) : 0);
	const circumference = $derived(2 * Math.PI * radius);
	const center = $derived(size / 2);
	const boxStyle = $derived(`width: ${size}px; height: ${size}px`);
	const viewBox = $derived(`0 0 ${size} ${size}`);
</script>

<div class="flex flex-col items-center gap-2">
	<div class="relative" style={boxStyle}>
		<svg width={size} height={size} {viewBox} class="-rotate-90" aria-hidden="true">
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				stroke="var(--color-secondary)"
				stroke-width={stroke}
			/>
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				stroke="var(--color-primary)"
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-dasharray={circumference}
				stroke-dashoffset={circumference * (1 - ratio)}
				class="transition-[stroke-dashoffset] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
			/>
		</svg>
		<div class="absolute inset-0 flex flex-col items-center justify-center">
			<span class={cn('tabular font-display tracking-tight', emphasis ? 'text-3xl' : 'text-2xl')}>
				{Math.round(value)}
			</span>
			<span class="text-muted-foreground text-xs">
				of {Math.round(target)}
				{unit}
			</span>
		</div>
	</div>
	{#if label}
		<p class="text-sm font-medium">{label}</p>
	{/if}
</div>

<script lang="ts">
	/**
	 * One progress ring: a muted track circle plus a clockwise-from-top arc on
	 * top of it. Deliberately has no `<svg>` wrapper of its own so callers can
	 * nest several inside one shared, rotated `<svg>` — that's what lets
	 * `MacroRing` (a single ring) and `GlpRingCluster` (three nested rings)
	 * share this one drawing instead of each carrying its own copy.
	 */
	let {
		cx,
		cy,
		radius,
		stroke,
		color,
		trackColor = 'var(--color-secondary)',
		ratio
	}: {
		cx: number;
		cy: number;
		radius: number;
		stroke: number;
		color: string;
		trackColor?: string;
		ratio: number;
	} = $props();

	const circumference = $derived(2 * Math.PI * radius);
</script>

<circle {cx} {cy} r={radius} fill="none" stroke={trackColor} stroke-width={stroke} />
<circle
	{cx}
	{cy}
	r={radius}
	fill="none"
	stroke={color}
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-dasharray={circumference}
	stroke-dashoffset={circumference * (1 - ratio)}
	class="transition-[stroke-dashoffset] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
/>

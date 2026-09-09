<script lang="ts">
	/**
	 * Apple-Activity-style concentric rings for GLP-1 mode: Energy outside,
	 * Protein in the middle, Fiber innermost, all sharing one centre. The
	 * centre stays empty until a ring is hovered (desktop) or the cluster is
	 * tapped/keyed (touch and keyboard), which cycles Energy -> Protein ->
	 * Fiber -> empty — thin nested rings are too easy to miss on a tap, so a
	 * single cluster-wide cycle stands in for tapping one ring precisely.
	 */
	import RingArc from './RingArc.svelte';

	let {
		energyValue,
		energyTarget,
		proteinValue,
		proteinTarget,
		fiberValue,
		fiberTarget,
		size = 148
	}: {
		energyValue: number;
		energyTarget: number;
		proteinValue: number;
		proteinTarget: number;
		fiberValue: number;
		fiberTarget: number;
		size?: number;
	} = $props();

	type RingKey = 'energy' | 'protein' | 'fiber';

	const STROKE = 10;
	const GAP = 4;
	/** Cycle order: three rings, then empty, then back to the first. */
	const ORDER: (RingKey | null)[] = ['energy', 'protein', 'fiber', null];

	const rings = $derived(
		(
			[
				{
					key: 'energy',
					name: 'Energy',
					unit: 'kcal',
					value: energyValue,
					target: energyTarget,
					color: 'var(--color-primary)'
				},
				{
					key: 'protein',
					name: 'Protein',
					unit: 'g',
					value: proteinValue,
					target: proteinTarget,
					color: 'var(--color-destructive)'
				},
				{
					key: 'fiber',
					name: 'Fiber',
					unit: 'g',
					value: fiberValue,
					target: fiberTarget,
					color: 'var(--color-sage-soft)'
				}
			] as const
		).map((ring, i) => ({
			...ring,
			radius: (size - STROKE - 4) / 2 - i * (STROKE + GAP),
			ratio: ring.target > 0 ? Math.min(ring.value / ring.target, 1) : 0
		}))
	);

	let selected = $state<RingKey | null>(null);
	let hovered = $state<RingKey | null>(null);

	const displayed = $derived.by(() => {
		const key = hovered ?? selected;
		return rings.find((ring) => ring.key === key) ?? null;
	});

	const ariaLabel = $derived(
		rings
			.map(
				(ring) =>
					`${ring.name} ${Math.round(ring.value)} of ${Math.round(ring.target)} ${ring.unit}`
			)
			.join(', ')
	);

	const boxStyle = $derived(`width: ${size}px; height: ${size}px`);
	const viewBox = $derived(`0 0 ${size} ${size}`);

	function cycle(step: number) {
		const index = ORDER.indexOf(selected);
		selected = ORDER[(index + step + ORDER.length) % ORDER.length] ?? null;
		// A mobile browser's post-tap compatibility pointerenter has already set
		// `hovered` by the time this click handler runs (pointerType gate below
		// only screens the enter, not this) — clear it here so the tap-driven
		// cycle through `selected` is what shows, not a ring pinned by that
		// synthetic hover.
		hovered = null;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
			event.preventDefault();
			cycle(1);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
			event.preventDefault();
			cycle(-1);
		}
	}

	/**
	 * Desktop-only reveal: touch and pen produce a compatibility pointerenter
	 * on tap with no matching pointerleave, which would otherwise pin the
	 * centre on whichever ring was tapped and stop the tap cycle from ever
	 * reaching Protein or Fiber (mobile-chrome reproduction: three taps, all
	 * showed Energy).
	 */
	function hover(key: RingKey, event: PointerEvent) {
		if (event.pointerType !== 'mouse') return;
		hovered = key;
	}

	function clearHover(event: PointerEvent) {
		if (event.pointerType !== 'mouse') return;
		hovered = null;
	}
</script>

<button
	type="button"
	class="focus-visible:ring-ring relative rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
	style={boxStyle}
	aria-label={ariaLabel}
	onclick={() => cycle(1)}
	{onkeydown}
>
	<svg width={size} height={size} {viewBox} class="-rotate-90" aria-hidden="true">
		{#each rings as ring (ring.key)}
			<g
				role="presentation"
				onpointerenter={(event) => hover(ring.key, event)}
				onpointerleave={clearHover}
			>
				<RingArc
					cx={size / 2}
					cy={size / 2}
					radius={ring.radius}
					stroke={STROKE}
					color={ring.color}
					ratio={ring.ratio}
				/>
			</g>
		{/each}
	</svg>
	<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
		{#if displayed}
			<span class="text-sm font-medium">{displayed.name}</span>
			<span class="tabular font-display text-2xl tracking-tight">{Math.round(displayed.value)}</span
			>
			<span class="text-muted-foreground text-xs">
				of {Math.round(displayed.target)}
				{displayed.unit}
			</span>
		{/if}
	</div>
</button>

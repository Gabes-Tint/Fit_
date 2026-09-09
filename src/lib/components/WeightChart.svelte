<script lang="ts">
	import type { UnitSystem, WeightEntry } from '$lib/domain/types';
	import { displayWeight, formatWeight, weightUnitAbbr, weightUnitName } from '$lib/domain/units';
	import { monthDay } from '$lib/domain/utils';

	let { weights, units = 'metric' }: { weights: WeightEntry[]; units?: UnitSystem } = $props();

	const WIDTH = 320;
	const HEIGHT = 140;
	/**
	 * `top` carries the scrub label's own row on top of the usual clearance, so
	 * the label appearing or clearing never moves the plot: the row is reserved
	 * whether or not anything is selected right now.
	 */
	const PAD = { top: 26, right: 8, bottom: 20, left: 34 };
	const LABEL_Y = 14;
	/** Half the widest label this component prints ("Dec 31 · 220.5 lb"), so a clamped label never runs past the plot edge. */
	const LABEL_HALF_WIDTH = 60;

	let svgEl: SVGSVGElement | undefined = $state();
	let selectedIndex = $state<number | null>(null);
	let activePointerId: number | null = null;

	const points = $derived([...weights].sort((a, b) => a.date.localeCompare(b.date)));

	const geometry = $derived.by(() => {
		const first = points[0];
		const last = points.at(-1);
		if (!first || !last || points.length < 2) return null;
		const values = points.map((p) => p.kg);
		// Pad the domain so a flat trend does not hug the top or bottom edge.
		const min = Math.min(...values) - 0.6;
		const max = Math.max(...values) + 0.6;
		const span = max - min || 1;
		const plotW = WIDTH - PAD.left - PAD.right;
		const plotH = HEIGHT - PAD.top - PAD.bottom;

		const xy = points.map((p, i) => ({
			x: PAD.left + (i / (points.length - 1)) * plotW,
			y: PAD.top + (1 - (p.kg - min) / span) * plotH,
			entry: p
		}));

		return {
			path: xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
			xy,
			gridlines: [0, 0.5, 1].map((t) => ({
				y: PAD.top + t * plotH,
				label: displayWeight(max - t * span, units).toFixed(1)
			})),
			firstDate: monthDay(first.date),
			lastDate: monthDay(last.date),
			caption:
				`Weight trend from ${monthDay(first.date)} to ${monthDay(last.date)}, ` +
				`${displayWeight(first.kg, units)} to ${displayWeight(last.kg, units)} ${weightUnitName(units)}`
		};
	});

	const selected = $derived(selectedIndex !== null ? (geometry?.xy[selectedIndex] ?? null) : null);

	const selectedLabel = $derived(
		selected
			? `${monthDay(selected.entry.date)} · ${formatWeight(selected.entry.kg, units)} ${weightUnitAbbr(units)}`
			: ''
	);

	/** Clamped so the label's own box never overflows the plot's left or right edge. */
	const labelX = $derived.by(() => {
		if (!selected) return WIDTH / 2;
		const min = PAD.left + LABEL_HALF_WIDTH;
		const max = WIDTH - PAD.right - LABEL_HALF_WIDTH;
		return Math.min(Math.max(selected.x, min), max);
	});

	/**
	 * Nearest measurement point to a pointer, in the SVG's own coordinate space.
	 *
	 * Mapped through `getScreenCTM`, not through the element's bounding box: with
	 * `preserveAspectRatio` at its default of `xMidYMid meet`, the viewBox is
	 * scaled to fit whatever box the card gives the chart and centred in what is
	 * left over. On a card wider than the 320:140 viewBox the drawing therefore
	 * sits between two empty side bars, and dividing by the element's own width
	 * would pull every reading toward the middle — pointing at the newest
	 * weigh-in would select an older one.
	 */
	function nearestIndex(event: PointerEvent): number | null {
		if (!geometry || !svgEl) return null;
		const screenToUser = svgEl.getScreenCTM();
		// A chart with no layout box yet scales by zero, and that matrix has no inverse.
		if (!screenToUser?.a) return null;
		const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(screenToUser.inverse()).x;
		let best = 0;
		let bestDist = Infinity;
		geometry.xy.forEach((p, i) => {
			const dist = Math.abs(p.x - x);
			if (dist < bestDist) {
				bestDist = dist;
				best = i;
			}
		});
		return best;
	}

	function handlePointerDown(event: PointerEvent) {
		activePointerId = event.pointerId;
		selectedIndex = nearestIndex(event);
		// Capture keeps a drag alive once the finger or cursor leaves the SVG's own box.
		// A synthetic pointer, as the component specs dispatch, has no live hardware behind
		// it, so a real browser refuses to capture it — harmless here, since a single
		// dispatched event never leaves the box in the first place.
		try {
			svgEl?.setPointerCapture(event.pointerId);
		} catch {
			// no live pointer to capture — see above
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (activePointerId === null || event.pointerId !== activePointerId) return;
		selectedIndex = nearestIndex(event);
	}

	/**
	 * Chosen touch-clearing mechanism: a finger's selection outlives the lift
	 * (unlike a mouse's, cleared right here) so the reading stays legible once
	 * the hand is out of the way, and clears only when a new touch lands on the
	 * chart — `handlePointerDown` above already re-selects on every pointerdown,
	 * touch included, so nothing further is needed to make "a new touch starts
	 * elsewhere on the chart" replace the old reading with the new one.
	 *
	 * Bound to `pointercancel` as well as `pointerup`: a system gesture or a
	 * second finger takes the pointer away without ever sending an up event, and
	 * leaving `activePointerId` set would make the chart ignore every later move
	 * from a fresh pointer. The same rule applies either way — a mouse or pen
	 * loses its reading, a finger keeps it.
	 */
	function handlePointerUp(event: PointerEvent) {
		if (activePointerId === null || event.pointerId !== activePointerId) return;
		if (event.pointerType !== 'touch') selectedIndex = null;
		activePointerId = null;
	}

	/** Only a mouse (or pen) leaving clears — a finger's own pointerleave fires on lift, which must not discard the reading. */
	function handlePointerLeave(event: PointerEvent) {
		if (event.pointerType === 'touch') return;
		selectedIndex = null;
	}
</script>

{#if geometry}
	<svg
		bind:this={svgEl}
		viewBox="0 0 {WIDTH} {HEIGHT}"
		class="h-full w-full touch-none"
		role="img"
		aria-label={geometry.caption}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onpointerleave={handlePointerLeave}
	>
		{#each geometry.gridlines as line (line.y)}
			<line
				x1={PAD.left}
				x2={WIDTH - PAD.right}
				y1={line.y}
				y2={line.y}
				stroke="var(--color-border)"
			/>
			<text
				x={PAD.left - 6}
				y={line.y + 4}
				text-anchor="end"
				font-size="11"
				fill="var(--color-muted-foreground)"
			>
				{line.label}
			</text>
		{/each}
		<path d={geometry.path} fill="none" stroke="var(--color-primary)" stroke-width="2" />
		{#if selected}
			<line
				class="guide"
				x1={selected.x}
				x2={selected.x}
				y1={PAD.top}
				y2={selected.y}
				stroke="var(--color-muted-foreground)"
				stroke-width="1"
				stroke-dasharray="4 3"
			/>
		{/if}
		{#each geometry.xy as p, i (p.entry.id)}
			<circle
				class="dot"
				cx={p.x}
				cy={p.y}
				r={i === selectedIndex ? 5 : 2.5}
				fill="var(--color-primary)"
			/>
		{/each}
		<text
			x={labelX}
			y={LABEL_Y}
			text-anchor="middle"
			font-size="11"
			font-weight="600"
			fill="var(--color-foreground)"
		>
			{selectedLabel}
		</text>
		<text x={PAD.left} y={HEIGHT - 4} font-size="11" fill="var(--color-muted-foreground)">
			{geometry.firstDate}
		</text>
		<text
			x={WIDTH - PAD.right}
			y={HEIGHT - 4}
			text-anchor="end"
			font-size="11"
			fill="var(--color-muted-foreground)"
		>
			{geometry.lastDate}
		</text>
	</svg>
	<span class="sr-only" aria-live="polite">{selectedLabel}</span>
{:else}
	<p class="text-muted-foreground flex h-full items-center justify-center text-sm">
		Log a few weigh-ins to see the trend.
	</p>
{/if}

<style>
	.dot,
	.guide {
		transition:
			r 120ms ease,
			opacity 120ms ease;
	}
</style>

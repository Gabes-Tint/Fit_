<script lang="ts">
	import { loadTrend, trainedExercises, weekSpan } from '$lib/domain/training-progress';
	import type { Workout } from '$lib/domain/types';
	import { displayLoad } from '$lib/domain/units';
	import { round1 } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';

	let { workouts }: { workouts: Workout[] } = $props();

	let picked = $state('');

	const unit = $derived(tend.state.loadUnit);

	const names = $derived(trainedExercises(workouts));
	const name = $derived(names.includes(picked) ? picked : (names[0] ?? ''));
	/**
	 * The trend comes back in stored kilograms and is converted once, here, so the
	 * bars, the labels, the caption and the screen-reader description are all the
	 * same numbers — a chart whose caption disagreed with its bars would be worse
	 * than no caption.
	 */
	const points = $derived(
		(name === '' ? [] : loadTrend(workouts, name)).map((point) => ({
			...point,
			load: displayLoad(point.load, unit)
		}))
	);

	const bars = $derived.by(() => {
		const loads = points.map((p) => p.load);
		const top = Math.max(0, ...loads);
		const low = Math.min(top, ...loads);
		// Loads move in small steps, so the floor sits just below the lightest week; zero would flatten them.
		const floor = Math.max(0, low - (top - low) * 0.6);
		return points.map((point, i) => {
			const height = top === floor ? 100 : ((point.load - floor) / (top - floor)) * 100;
			return { ...point, style: `height: ${height}%`, latest: i === points.length - 1 };
		});
	});

	const caption = $derived.by(() => {
		const first = points[0];
		const last = points.at(-1);
		if (!first || !last) return '';
		// Weeks elapsed, first to last point, not the number of bars drawn.
		const weeks = weekSpan(points);
		const span = `top set, last ${weeks} week${weeks === 1 ? '' : 's'}`;
		if (points.length === 1) return `${name} · ${span}`;
		const change = round1(last.load - first.load);
		const move = change === 0 ? 'no change' : `${change > 0 ? '+' : ''}${change} ${unit}`;
		return `${name} · ${span} · ${move}`;
	});

	const described = $derived(
		`${name}, top set by week: ${points.map((p) => `${p.label} ${p.load} ${unit}`).join(', ')}`
	);
</script>

<section class="bg-card rounded-3xl p-4 shadow-border">
	{#if bars.length === 0}
		<h2 class="font-display text-lg tracking-tight">Load trend</h2>
		<p class="text-muted-foreground mt-1 text-sm">
			Nothing finished yet, so there is no load to follow.
		</p>
	{:else}
		<p class="text-muted-foreground text-sm">{caption}</p>
		<div class="mt-3 flex items-end gap-1.5" role="img" aria-label={described}>
			{#each bars as bar (`${bar.year}-${bar.week}`)}
				<div class="flex flex-1 flex-col items-center gap-1">
					<span class="tabular text-primary h-3 text-[0.65rem] leading-3">
						{bar.latest ? `${bar.load} ${unit}` : ''}
					</span>
					<div class="flex h-20 w-full items-end">
						<span
							class={['w-full rounded-t-md', bar.latest ? 'bg-primary' : 'bg-accent']}
							style={bar.style}
						></span>
					</div>
					<span class="text-muted-foreground text-[0.65rem]">{bar.label}</span>
				</div>
			{/each}
		</div>
	{/if}
	{#if names.length > 1}
		<div class="mt-3 flex flex-wrap gap-1.5">
			{#each names as option (option)}
				<ToggleButton
					pressed={option === name}
					onclick={() => (picked = option)}
					resting="bg-secondary text-foreground/70"
					class="min-h-9 rounded-full px-3.5 text-xs"
				>
					{option}
				</ToggleButton>
			{/each}
		</div>
	{/if}
</section>

<script lang="ts">
	import { cn } from '$lib/ui/cn';
	import type { PlanOption } from './plan-options';

	/**
	 * One day of the planned week. The whole row is the control, and what the day
	 * holds is drawn in the order it is trained — a day is allowed more than one
	 * routine, and a day holding none is a rest day.
	 */
	let {
		label,
		sessions,
		isToday,
		onpick
	}: {
		/** "Mon 31 Aug". */
		label: string;
		/** The routines on the day, in the order they are trained. */
		sessions: PlanOption[];
		isToday: boolean;
		onpick: () => void;
	} = $props();

	const description = $derived(
		`${label}, ${
			sessions.length > 0
				? sessions.map((option) => option.name).join(', then ')
				: 'nothing planned'
		}`
	);
</script>

<button
	type="button"
	onclick={onpick}
	aria-label={description}
	class={cn(
		'shadow-border flex w-full items-center gap-3 rounded-2xl p-3.5 text-left',
		sessions[0]?.tone.tint ?? 'bg-card'
	)}
>
	<span class={cn('w-24 shrink-0 text-[15px]', isToday ? 'font-semibold' : 'font-medium')}>
		{label}
	</span>
	<span class="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5" aria-hidden="true">
		{#if sessions.length > 0}
			<!-- Keyed by position: the same routine may sit on a day twice over its life of edits. -->
			{#each sessions as option, index (index)}
				<span class={cn('rounded-full px-2.5 py-1 text-[11.5px] font-medium', option.tone.solid)}>
					{option.name}
				</span>
			{/each}
		{:else}
			<span class="text-muted-foreground text-xs">Rest</span>
		{/if}
	</span>
</button>

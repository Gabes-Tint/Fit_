<script lang="ts">
	import { cn } from '$lib/ui/cn';
	import Sheet from '$lib/ui/Sheet.svelte';
	import type { PlanOption } from './plan-options';

	/**
	 * What one day holds, one routine at a time. Tapping puts a routine on the
	 * day; tapping it again takes it off, and the order they went on is the order
	 * they are trained. There is nothing to pick for rest — a day left empty is
	 * the rest day.
	 */
	let {
		open = $bindable(false),
		day,
		options,
		chosen,
		onpick,
		onclose
	}: {
		open?: boolean;
		/** The day being planned, or nothing while none is. */
		day: { heading: string; when: string } | null;
		options: PlanOption[];
		/** Routine ids already on the day, in order. */
		chosen: string[];
		onpick: (routineId: string) => void;
		onclose: () => void;
	} = $props();
</script>

{#if day}
	<Sheet bind:open title={day.heading} description={day.when} {onclose}>
		<div class="flex flex-col gap-2 px-5 pt-3.5 pb-6">
			{#each options as option (option.id)}
				{@const position = chosen.indexOf(option.id)}
				<button
					type="button"
					aria-pressed={position >= 0}
					onclick={() => onpick(option.id)}
					class={cn(
						'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left',
						position >= 0 ? cn(option.tone.tint, 'border-transparent') : 'border-border'
					)}
				>
					<span
						class={cn(
							'flex size-7 flex-none items-center justify-center rounded-lg text-xs font-semibold',
							position >= 0 ? option.tone.solid : 'bg-secondary text-muted-foreground'
						)}
					>
						{position >= 0 ? position + 1 : option.letter}
					</span>
					<span class="min-w-0 flex-1">
						<span
							class={cn(
								'block text-[15px] font-medium',
								position >= 0 ? '' : 'text-muted-foreground'
							)}
						>
							{option.name}
						</span>
						<span class="text-foreground/70 block text-xs">
							{position >= 0 ? `Session ${position + 1} of the day` : 'Not on this day'}
						</span>
					</span>
				</button>
			{/each}
			<p class="text-muted-foreground px-1 pt-1 text-xs">
				{chosen.length === 0
					? 'Nothing on the day, which is what a rest day is.'
					: 'Tap one again to take it off. A day can hold more than one.'}
			</p>
		</div>
	</Sheet>
{/if}

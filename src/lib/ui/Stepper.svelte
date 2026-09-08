<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/ui/cn';

	/**
	 * Stateless: the caller owns the value and the step, this only reports the direction.
	 * `QuantityStepper` wraps it for the callers that would rather bind a number.
	 */
	let {
		value,
		label = '',
		size = 'sm',
		onstep,
		readout,
		class: className
	}: {
		/** The number between the buttons. Omitted when `readout` renders it instead. */
		value?: string | number | undefined;
		/** The noun being adjusted — "reps", "load" — used to name both buttons. */
		label?: string | undefined;
		/** `sm` sits inside a row of its own; `md` stands alone beside 40px controls. */
		size?: 'sm' | 'md' | undefined;
		onstep: (direction: number) => void;
		/**
		 * What sits between the two buttons, when a plain reading is not enough
		 * — an editable field, for a stepper whose number can also be typed
		 * (#158). The buttons, their sizing and their labels stay here, so a
		 * typed amount and a tapped one are still the same control.
		 */
		readout?: Snippet | undefined;
		class?: string | undefined;
	} = $props();

	// Both variants carry their fill at rest. Chrome that only arrives on hover
	// never arrives at all on a touch screen, which is where every one of these
	// is actually pressed.
	const SIZES = {
		sm: {
			button: 'bg-secondary text-muted-foreground size-8 rounded-lg active:scale-[0.96]',
			icon: 'size-3.5',
			readout: 'w-9'
		},
		md: {
			button: 'bg-secondary text-foreground size-10 rounded-xl active:scale-[0.96]',
			icon: 'size-4',
			readout: 'min-w-10 font-medium'
		}
	} as const;

	const style = $derived(SIZES[size]);
	const button = $derived(
		cn('flex items-center justify-center transition-transform duration-150', style.button)
	);
	// A stepper with nothing to name adjusts the only number in view, so its
	// buttons say what they do rather than trailing an empty noun.
	const decrease = $derived(label ? `Decrease ${label}` : 'Decrease');
	const increase = $derived(label ? `Increase ${label}` : 'Increase');
</script>

<div class={cn('flex items-center gap-1', className)}>
	<button type="button" class={button} aria-label={decrease} onclick={() => onstep(-1)}>
		<Minus class={style.icon} />
	</button>
	{#if readout}
		{@render readout()}
	{:else}
		<span class={cn('tabular text-center text-sm', style.readout)}>{value}</span>
	{/if}
	<button type="button" class={button} aria-label={increase} onclick={() => onstep(1)}>
		<Plus class={style.icon} />
	</button>
</div>

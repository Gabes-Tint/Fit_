<script lang="ts">
	import { scaleFood } from '$lib/domain/foods';
	import {
		amountFromGrams,
		amountGrams,
		massInUnits,
		massToGrams,
		parseAmount,
		roundAmount,
		stepAmount
	} from '$lib/domain/serving-amount';
	import type { Food } from '$lib/domain/types';
	import { formatServingMass } from '$lib/domain/units';
	import { wholePackGrams } from '$lib/domain/whole-pack';
	import { tend } from '$lib/state/tend.svelte';
	import Stepper from '$lib/ui/Stepper.svelte';

	/**
	 * How much of this food, said in the food's own serving (#158).
	 *
	 * The number this reports is always servings, whichever unit the field is
	 * being typed in, because servings are what a proposal and a `LogItem`
	 * have always stored. Grams are derived for reading and converted back only
	 * when somebody types into the grams field, so the toggle itself moves
	 * nothing: a half serving that goes into grams comes back out a half
	 * serving, not 109.5 g read back as 0.5000000001.
	 */
	let {
		food,
		servings,
		step,
		onchange
	}: {
		/** The catalog food behind the amount, once one has been matched to it. */
		food?: Food | undefined;
		servings: number;
		/** Half a serving, or a quarter for someone eating in quarters (`profile.ts`). */
		step: number;
		onchange: (servings: number) => void;
	} = $props();

	const units = $derived(tend.state.units);
	const grams = $derived(food === undefined ? null : amountGrams(food, servings));
	const packGrams = $derived(food === undefined ? null : wholePackGrams(food));

	/**
	 * The amount "whole pack" stands for, in servings — `null` when the source
	 * named no package, which is most foods.
	 */
	const pack = $derived(
		food === undefined || packGrams === null ? null : amountFromGrams(food, packGrams)
	);

	/**
	 * Which unit the field is typed in. Component state, deliberately: it is a
	 * way of entering a number, not a property of what was eaten, so it is not
	 * on the proposal, not in the state document, and gone when the sheet
	 * closes. A food with no serving weight has nothing to convert against, so
	 * the toggle is not offered and `grams === null` keeps the field in
	 * servings even if this is somehow left true.
	 */
	let inGrams = $state(false);
	const editingGrams = $derived(inGrams && grams !== null);

	/**
	 * What is part-way through being typed, or `null` when the field is showing
	 * the amount itself. Without it "1." would be rewritten to "1" under the
	 * caret before the person could type the digit after the point.
	 */
	let draft = $state<string | null>(null);

	const shown = $derived(
		grams !== null && inGrams ? String(massInUnits(grams, units)) : String(roundAmount(servings))
	);
	const text = $derived(draft ?? shown);
	// A weight is read and typed in the person's own system, the same as every
	// other mass in the app (#71, #74) — so an imperial reader never meets a
	// gram here, and the toggle names ounces rather than promising grams.
	const massName = $derived(units === 'imperial' ? 'ounces' : 'grams');
	const massAbbr = $derived(units === 'imperial' ? 'oz' : 'g');
	const unit = $derived(editingGrams ? massAbbr : servings === 1 ? 'serving' : 'servings');
	const fieldLabel = $derived(editingGrams ? `Amount in ${massName}` : 'Amount in servings');
	const toggleLabel = $derived(
		editingGrams ? 'Enter the amount in servings' : `Enter the amount in ${massName}`
	);

	/** The energy and macros of what is about to be logged, re-read on every change. */
	const energy = $derived.by(() => {
		if (food === undefined) return '';
		const scaled = scaleFood(food, servings);
		return `${scaled.kcal} kcal · ${scaled.protein}g protein · ${scaled.carbs}g carbs · ${scaled.fat}g fat`;
	});

	function typed(value: string) {
		draft = value;
		const amount = parseAmount(value);
		// Text that names no amount leaves the quantity where it is: someone
		// mid-way through clearing the field has not asked to log nothing.
		if (amount === null) return;
		if (!editingGrams) {
			onchange(amount);
			return;
		}
		const next = food === undefined ? null : amountFromGrams(food, massToGrams(amount, units));
		if (next !== null) onchange(next);
	}

	function stepped(direction: number) {
		draft = null;
		onchange(stepAmount(servings, step * direction));
	}

	function switchUnit() {
		inGrams = !inGrams;
		draft = null;
	}

	function choose(amount: number) {
		draft = null;
		onchange(amount);
	}

	const CHIP = 'bg-secondary text-muted-foreground h-8 shrink-0 rounded-full px-3 text-xs';
</script>

{#if food !== undefined && pack !== null && packGrams !== null}
	<div class="mt-2 flex flex-wrap gap-1.5">
		<button type="button" class={CHIP} onclick={() => choose(1)}>{food.servingLabel}</button>
		<button type="button" class={CHIP} onclick={() => choose(pack)}>
			Whole pack · {formatServingMass(packGrams, units)}
		</button>
	</div>
{/if}

<div class="mt-2 flex items-center gap-2">
	<Stepper size="md" onstep={stepped}>
		{#snippet readout()}
			<input
				value={text}
				oninput={(event) => typed(event.currentTarget.value)}
				onblur={() => (draft = null)}
				inputmode="decimal"
				aria-label={fieldLabel}
				class="tabular bg-secondary h-10 w-14 rounded-xl text-center text-sm font-medium"
			/>
		{/snippet}
	</Stepper>
	<span class="text-muted-foreground text-xs">{unit}</span>
	{#if grams !== null}
		<button
			type="button"
			onclick={switchUnit}
			aria-label={toggleLabel}
			class="text-muted-foreground hover:bg-secondary ml-auto h-10 shrink-0 rounded-xl px-3 text-sm"
		>
			{editingGrams ? 'servings' : massAbbr}
		</button>
	{/if}
</div>

{#if energy}
	<p class="text-muted-foreground mt-1.5 text-xs">{energy}</p>
{/if}

<script lang="ts">
	import {
		amountFromGrams,
		amountGrams,
		describeEnergy,
		massInUnits,
		massToGrams,
		parseAmount,
		roundAmount,
		stepAmount
	} from '$lib/domain/serving-amount';
	import { describePortion } from '$lib/domain/serving-display';
	import type { Food } from '$lib/domain/types';
	import { formatServingMass } from '$lib/domain/units';
	import { readsAsServings } from '$lib/domain/usual-portion';
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
		usual = null,
		onchange
	}: {
		/** The catalog food behind the amount, once one has been matched to it. */
		food?: Food | undefined;
		servings: number;
		/** Half a serving, or a quarter for someone eating in quarters (`profile.ts`). */
		step: number;
		/**
		 * What this person last logged of this food, in servings, or `null` for a
		 * food they have never logged (#159). The caller opens the amount at it;
		 * this control is what says so, so that a card sitting at 1.607 servings
		 * is explained rather than merely odd.
		 */
		usual?: number | null;
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

	/** The remembered amount as the app words every other portion (#74). */
	const usualPortion = $derived(
		food === undefined || usual === null ? '' : describePortion(food, usual, units)
	);

	/**
	 * Which unit the field is typed in, once the person has said — `null` until
	 * then. Component state, deliberately: it is a way of entering a number, not
	 * a property of what was eaten, so it is not on the proposal, not in the
	 * state document, and gone when the sheet closes. A food with no serving
	 * weight has nothing to convert against, so the toggle is not offered and
	 * `grams === null` keeps the field in servings whatever this holds.
	 */
	let inGrams = $state<boolean | null>(null);

	/**
	 * Which unit the field opens in when nobody has picked one: weight, when the
	 * card was opened at a remembered amount that only reads as a weight. 45 g of
	 * a 28 g serving is 1.607 servings, and a field showing "1.607" would be
	 * showing a number the person never chose (#159).
	 */
	const opensInGrams = $derived(usual !== null && !readsAsServings(usual));
	const editingGrams = $derived((inGrams ?? opensInGrams) && grams !== null);

	/**
	 * What is part-way through being typed, or `null` when the field is showing
	 * the amount itself. Without it "1." would be rewritten to "1" under the
	 * caret before the person could type the digit after the point.
	 */
	let draft = $state<string | null>(null);

	const shown = $derived(
		grams !== null && editingGrams
			? String(massInUnits(grams, units))
			: String(roundAmount(servings))
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
	const energy = $derived(food === undefined ? '' : describeEnergy(food, servings));

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
		inGrams = !editingGrams;
		draft = null;
	}

	/**
	 * Take one of the chips. The field goes back to servings: a chip is a count
	 * of the food's own serving, and the person taking one has picked an amount
	 * outright, so the unit a remembered amount opened in no longer governs.
	 */
	function choose(amount: number) {
		draft = null;
		inGrams = false;
		onchange(amount);
	}

	const CHIP = 'bg-secondary text-muted-foreground h-8 shrink-0 rounded-full px-3 text-xs';
</script>

{#if food !== undefined && usual !== null}
	<p class="text-muted-foreground mt-2 text-xs">Your usual · {usualPortion}</p>
{/if}

{#if food !== undefined && (pack !== null || usual !== null)}
	<div class="mt-2 flex flex-wrap gap-1.5">
		<!-- The label serving, which is the one tap back to it (#159). -->
		<button type="button" class={CHIP} onclick={() => choose(1)}>{food.servingLabel}</button>
		{#if pack !== null && packGrams !== null}
			<button type="button" class={CHIP} onclick={() => choose(pack)}>
				Whole pack · {formatServingMass(packGrams, units)}
			</button>
		{/if}
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

<script lang="ts">
	import { exportCsv, exportJson, mfpRowsToLogItems, parseMfpCsv } from '$lib/domain/export-data';
	import { computeTargets } from '$lib/domain/tdee';
	import type { Injection, LoadUnit, UnitSystem } from '$lib/domain/types';
	import { heightFromFeetInches, heightToFeetInches } from '$lib/domain/units';
	import { todayISO, uid } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { download } from '$lib/ui/download';
	import Input from '$lib/ui/Input.svelte';
	import Label from '$lib/ui/Label.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Stepper from '$lib/ui/Stepper.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	// A stepper, not a typed field: typing into a bound-and-clamped number input
	// fights the person typing, since every keystroke re-clamps mid-entry.
	const REST_STEP = 15;

	let wipeOpen = $state(false);
	let redoOnboarding = $state(false);
	let energyError = $state('');

	/** The floor `computeTargets` itself enforces — an override may not sit below it. */
	const MIN_ENERGY_KCAL = 1200;
	let mfp = $state('');
	let dose = $state('0.5');
	let appetite = $state<Injection['appetite']>(3);
	let notes = $state('');

	const profile = $derived(tend.profile);
	const targets = $derived(profile ? computeTargets(profile) : null);

	// Read straight off the profile — an uncontrolled field, like a native
	// form, rather than a draft synced back on every keystroke. Nothing but
	// `saveHeight` ever writes `heightCm`, and it only reads the submitted
	// form values, so switching the units preference to look never drifts
	// the stored figure.
	function saveHeight(event: SubmitEvent) {
		event.preventDefault();
		if (!profile) return;
		const data = new FormData(event.currentTarget as HTMLFormElement);
		const stored = profile.heightCm;
		let cm: number;
		if (tend.state.units === 'imperial') {
			const feet = Number(data.get('height-ft'));
			const inches = Number(data.get('height-in'));
			const displayed = heightToFeetInches(stored);
			// An untouched form re-submits the *rounded* ft/in reading, which
			// would otherwise re-derive and overwrite an exact stored cm with a
			// lossy one (e.g. 180.5 cm displays as 5′11″, and
			// heightFromFeetInches(5, 11) reads back as 180.34, not 180.5). Only
			// a genuinely edited reading may change the stored value.
			cm =
				feet === displayed.feet && inches === displayed.inches
					? stored
					: heightFromFeetInches(feet, inches);
		} else {
			const entered = Number(data.get('height-cm'));
			// Same guard for metric: an untouched form resubmits Math.round(stored).
			cm = entered === Math.round(stored) ? stored : entered;
		}
		// A height has to be a positive number to mean anything; a blank or
		// non-numeric field, or zero or negative, is left unsaved.
		if (!Number.isFinite(cm) || cm <= 0) return;
		tend.patchActive((p) => ({ ...p, heightCm: cm }));
		toast('Height saved.');
	}

	function saveEnergy(event: SubmitEvent) {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		const value = Number(data.get('energy-kcal'));
		if (!Number.isInteger(value) || value < MIN_ENERGY_KCAL) {
			energyError = `Enter at least ${MIN_ENERGY_KCAL} kcal.`;
			return;
		}
		energyError = '';
		tend.patchActive((p) => ({ ...p, calorieOverride: value }));
		toast('Energy saved.');
	}

	function useAutomaticEnergy() {
		tend.patchActive((p) => ({ ...p, calorieOverride: null }));
		energyError = '';
		toast('Energy set to automatic.');
	}

	function setGlp1(on: boolean) {
		tend.patchActive((p) => ({
			...p,
			glp1: on,
			// Reset goal when mode is off; 'glp1' goal only exists for that mode.
			goal: on ? 'glp1' : p.goal === 'glp1' ? 'lose' : p.goal
		}));
	}

	function saveDose() {
		tend.addInjection({
			date: todayISO(),
			medication: 'semaglutide',
			doseMg: Number(dose) || 0,
			site: 'abdomen',
			appetite,
			sideEffects: [],
			notes
		});
		notes = '';
		toast('Dose noted.');
	}

	const UNIT_SYSTEMS: { id: UnitSystem; label: string }[] = [
		{ id: 'metric', label: 'Metric' },
		{ id: 'imperial', label: 'Imperial' }
	];

	const LOAD_UNITS: { id: LoadUnit; label: string }[] = [
		{ id: 'kg', label: 'kg' },
		{ id: 'lb', label: 'lb' }
	];

	function importMfp() {
		const items = mfpRowsToLogItems(parseMfpCsv(mfp), () => uid('l-'));
		if (!items.length) {
			toast('Couldn’t read that CSV.');
			return;
		}
		tend.addLogItems(items);
		toast(`Imported ${items.length} rows.`);
		mfp = '';
	}
</script>

<svelte:head>
	<title>You · Fit_</title>
</svelte:head>

{#if profile && targets}
	{#if redoOnboarding}
		<Onboarding redo onredo={() => (redoOnboarding = false)} />
	{:else}
		<div class="flex flex-col gap-6 pb-10">
			<PageHeader kicker="On this device" title="You" />

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<form onsubmit={saveHeight}>
					<p class="text-muted-foreground text-sm font-medium">Height</p>
					{#if tend.state.units === 'imperial'}
						{@const feetInches = heightToFeetInches(profile.heightCm)}
						<div class="mt-1.5 flex gap-3">
							<div class="flex items-center gap-2">
								<Input
									id="you-height-ft"
									name="height-ft"
									class="w-24"
									inputmode="numeric"
									aria-label="Height, feet"
									value={feetInches.feet}
								/>
								<Label for="you-height-ft">ft</Label>
							</div>
							<div class="flex items-center gap-2">
								<Input
									id="you-height-in"
									name="height-in"
									class="w-24"
									inputmode="numeric"
									aria-label="Height, inches"
									value={feetInches.inches}
								/>
								<Label for="you-height-in">in</Label>
							</div>
						</div>
					{:else}
						<div class="mt-1.5 flex items-center gap-2">
							<Input
								id="you-height-cm"
								name="height-cm"
								class="w-24"
								inputmode="numeric"
								aria-label="Height in centimeters"
								value={Math.round(profile.heightCm)}
							/>
							<Label for="you-height-cm">cm</Label>
						</div>
					{/if}
					<Button class="mt-2" size="sm" type="submit">Save height</Button>
				</form>
			</section>

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<h2 class="font-display text-xl tracking-tight">Preferences</h2>
				<div class="mt-3">
					<p class="text-muted-foreground text-sm font-medium">Units</p>
					<div class="mt-2 inline-flex gap-1" role="group" aria-label="Units: metric or imperial">
						{#each UNIT_SYSTEMS as u (u.id)}
							<ToggleButton
								pressed={tend.state.units === u.id}
								onclick={() => tend.setUnits(u.id)}
								resting="bg-secondary"
								class="h-10 rounded-full px-4 text-sm"
							>
								{u.label}
							</ToggleButton>
						{/each}
					</div>
					<p class="text-muted-foreground mt-2 text-xs">
						Body weight and height. Food amounts stay in grams.
					</p>
				</div>
				<div class="mt-4">
					<p class="text-muted-foreground text-sm font-medium">Exercise load label</p>
					<div
						class="mt-2 inline-flex gap-1"
						role="group"
						aria-label="Exercise load label: kg or lb"
					>
						{#each LOAD_UNITS as u (u.id)}
							<ToggleButton
								pressed={tend.state.loadUnit === u.id}
								onclick={() => tend.setLoadUnit(u.id)}
								resting="bg-secondary"
								class="h-10 rounded-full px-4 text-sm"
							>
								{u.label}
							</ToggleButton>
						{/each}
					</div>
					<p class="text-muted-foreground mt-2 text-xs">
						Exercise load. Relabels the bar only — a load already logged keeps its number.
					</p>
				</div>
				<div class="mt-4">
					<p class="text-muted-foreground text-sm font-medium">Rest between sets, seconds</p>
					<Stepper
						class="mt-1.5"
						size="md"
						value={tend.state.restSeconds}
						label="rest between sets"
						onstep={(direction) =>
							tend.setRestSeconds(tend.state.restSeconds + direction * REST_STEP)}
					/>
				</div>
			</section>

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h2 class="font-display text-xl tracking-tight">GLP-1 mode</h2>
						<p class="text-muted-foreground text-sm">
							Protein and fiber first. Calories quieter. Not medical advice.
						</p>
					</div>
					<Switch aria-label="GLP-1 mode" bind:checked={() => profile.glp1, setGlp1} />
				</div>
				{#if profile.glp1}
					<div class="bg-background mt-4 rounded-2xl p-3">
						<p class="text-sm font-medium">Log a dose</p>
						<div class="mt-2 grid grid-cols-2 gap-2">
							<div>
								<Label for="dose-mg">mg</Label>
								<Input id="dose-mg" class="mt-1" inputmode="decimal" bind:value={dose} />
							</div>
							<div>
								<Label for="dose-appetite">Appetite 1–5</Label>
								<Input
									id="dose-appetite"
									class="mt-1"
									type="number"
									min={1}
									max={5}
									bind:value={
										() => String(appetite),
										(v) =>
											(appetite = Math.min(5, Math.max(1, Number(v) || 3)) as Injection['appetite'])
									}
								/>
							</div>
						</div>
						<Label for="dose-notes" class="mt-2 block">Notes, side effects</Label>
						<Textarea
							id="dose-notes"
							class="mt-1 min-h-24"
							rows={2}
							bind:value={notes}
							placeholder="Nausea, constipation, quiet appetite…"
						/>
						<Button class="mt-2" size="sm" onclick={saveDose}>Save dose</Button>
						<ul class="text-muted-foreground mt-3 flex flex-col gap-1 text-sm">
							{#each profile.injections.slice(-4).reverse() as inj (inj.id)}
								<li>{inj.date} · {inj.doseMg} mg · appetite {inj.appetite}/5</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<h2 class="font-display text-xl tracking-tight">Targets</h2>
				<button
					type="button"
					class="text-primary mt-1 inline-flex h-10 items-center text-sm font-medium"
					onclick={() => (redoOnboarding = true)}
				>
					Redo setup
				</button>
				<p class="text-muted-foreground mt-1 text-sm">
					{targets.source === 'adaptive'
						? 'Updating from your weight trend and intake.'
						: targets.source === 'override'
							? 'You’re steering these by hand.'
							: 'Formula estimate until two weeks of logs exist.'}
				</p>
				<dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
					<div class="bg-background rounded-2xl px-3 py-2">
						<dt class="text-muted-foreground text-xs">Energy</dt>
						<form onsubmit={saveEnergy} class="mt-1 flex items-center gap-1">
							<Input
								id="you-energy-kcal"
								name="energy-kcal"
								class="h-8 w-20 px-2 text-sm"
								inputmode="numeric"
								aria-label="Energy, kcal"
								value={targets.kcal}
							/>
							<Button size="sm" type="submit">Save</Button>
						</form>
						{#if energyError}
							<p class="text-destructive mt-1 text-xs">{energyError}</p>
						{/if}
						{#if profile.calorieOverride != null}
							<button
								type="button"
								class="text-primary mt-1 block text-xs font-medium"
								onclick={useAutomaticEnergy}
							>
								Use automatic
							</button>
						{/if}
					</div>
					{#each [['Protein', `${targets.protein} g`], ['Fiber', `${targets.fiber} g`], ['Carbs / fat', `${targets.carbs} / ${targets.fat} g`]] as const as [k, v] (k)}
						<div class="bg-background rounded-2xl px-3 py-2">
							<dt class="text-muted-foreground text-xs">{k}</dt>
							<dd class="tabular font-medium">{v}</dd>
						</div>
					{/each}
				</dl>
			</section>

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<h2 class="font-display text-xl tracking-tight">Privacy</h2>
				<ul class="text-muted-foreground mt-3 flex flex-col gap-2 text-sm">
					<li>No ad SDKs. No data brokers.</li>
					<li>
						Logs sync to the server for your account, so they follow you across every device you
						sign in on.
					</li>
					<li>
						USDA entries stay public-domain; Open Food Facts entries stay ODbL, never mixed inside
						one row.
					</li>
				</ul>
				<div class="mt-4 flex flex-col gap-2">
					<Button
						variant="secondary"
						onclick={() =>
							download(`fit-${todayISO()}.json`, exportJson(tend.state), 'application/json')}
					>
						Export JSON
					</Button>
					<Button
						variant="secondary"
						onclick={() =>
							download(`fit-${profile.name}-${todayISO()}.csv`, exportCsv(profile), 'text/csv')}
					>
						Export CSV
					</Button>
					<Button variant="outline" onclick={() => (wipeOpen = true)}>Delete everything</Button>
				</div>
			</section>

			<section class="bg-card rounded-3xl p-4 shadow-border">
				<h2 class="font-display text-xl tracking-tight">Import from MyFitnessPal</h2>
				<p class="text-muted-foreground mt-1 text-sm">
					Paste a diary CSV. Rows land on their own dates as custom lines you can correct.
				</p>
				<Textarea
					class="mt-3 min-h-24"
					rows={4}
					bind:value={mfp}
					aria-label="MyFitnessPal CSV"
					placeholder="Date,Meal,Name,Calories,Protein..."
				/>
				<Button class="mt-2" variant="secondary" onclick={importMfp}>Import</Button>
			</section>

			<Modal
				bind:open={wipeOpen}
				title="Delete this journal?"
				description="Everything on this device goes. There is no cloud copy. Export first if you might want it."
			>
				<div class="mt-5 flex gap-2">
					<Button variant="secondary" class="flex-1" onclick={() => (wipeOpen = false)}>Keep</Button
					>
					<Button
						class="flex-1"
						onclick={() => {
							tend.resetAll();
							wipeOpen = false;
						}}
					>
						Delete
					</Button>
				</div>
			</Modal>
		</div>
	{/if}
{/if}

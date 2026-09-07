<script lang="ts">
	import { emptyProfile } from '$lib/domain/profile';
	import type { Activity, Goal, Profile, Restriction } from '$lib/domain/types';
	import { heightFromFeetInches, heightToFeetInches, kgToLb, lbToKg } from '$lib/domain/units';
	import { untrack } from 'svelte';
	import { round1, todayISO, uid } from '$lib/domain/utils';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Label from '$lib/ui/Label.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';

	/**
	 * `redo`: re-asking the setup questions on an already-onboarded profile,
	 * from the You screen, rather than the first-run flow `AppShell` shows
	 * when `tend.state.onboarded` is false.
	 *
	 * The two paths finish differently on purpose. First-run `finish()` calls
	 * `tend.completeOnboarding`, which replaces the profile list wholesale —
	 * exactly what a fresh start means. A redo must not do that: it would
	 * wipe the log, weight history and injections `completeOnboarding` resets
	 * to empty. So a redo patches only the answered fields onto the existing
	 * active profile with `tend.patchActive`, which touches nothing else.
	 */
	let {
		redo = false,
		onredo
	}: {
		redo?: boolean;
		onredo?: () => void;
	} = $props();

	const GOALS: { id: Goal; label: string; hint: string }[] = [
		{ id: 'lose', label: 'Lose', hint: 'Gentle deficit' },
		{ id: 'maintain', label: 'Maintain', hint: 'Eat to TDEE' },
		{ id: 'gain', label: 'Gain', hint: 'Slow surplus' },
		{ id: 'glp1', label: 'GLP-1', hint: 'Protein first' }
	];

	const ACTIVITIES: { id: Activity; label: string }[] = [
		{ id: 'sedentary', label: 'Mostly sitting' },
		{ id: 'light', label: 'Walks most days' },
		{ id: 'moderate', label: 'Train 3–4×' },
		{ id: 'active', label: 'Train most days' }
	];

	const RESTRICTIONS: { id: Restriction; label: string }[] = [
		{ id: 'vegetarian', label: 'Vegetarian' },
		{ id: 'vegan', label: 'Vegan' },
		{ id: 'gluten-free', label: 'Gluten-free' },
		{ id: 'dairy-free', label: 'Dairy-free' },
		{ id: 'nut-free', label: 'Nut-free' },
		{ id: 'no-pork', label: 'No pork' },
		{ id: 'low-sodium', label: 'Low sodium' },
		{ id: 'high-protein', label: 'High protein' }
	];

	const SEXES: Profile['sex'][] = ['female', 'male', 'other'];

	// A redo has no welcome screen — it goes straight to the questions — and
	// the state below still starts at these fixed defaults rather than the
	// profile's current answers, so redoing setup never looks pre-filled.
	let step = $state(untrack(() => (redo ? 1 : 0)));
	let name = $state('Alex');
	let goal = $state<Goal>('lose');
	let glp1 = $state(false);
	let sex = $state<Profile['sex']>('female');
	let age = $state(34);
	let heightCm = $state(168);
	let kg = $state(78);
	let activity = $state<Activity>('light');
	let restrictions = $state<Restriction[]>(['nut-free']);

	const units = $derived(tend.state.units);
	// Only meaningful once `units` is imperial, but always computed so the
	// template never has to narrow a union type to reach it.
	const heightFeetInches = $derived(heightToFeetInches(heightCm));
	const weightDisplay = $derived(units === 'imperial' ? round1(kgToLb(kg)) : kg);

	// Converts exactly — no display rounding reaches storage, or a typed 160 lb
	// would not read back as 160 lb once round-tripped through kg.
	function setHeightFeet(value: string) {
		heightCm = heightFromFeetInches(Number(value), heightFeetInches.inches);
	}

	function setHeightInches(value: string) {
		heightCm = heightFromFeetInches(heightFeetInches.feet, Number(value));
	}

	function setHeightCm(value: string) {
		heightCm = Number(value);
	}

	function setWeightDisplay(value: string) {
		kg = units === 'imperial' ? lbToKg(Number(value)) : Number(value);
	}

	const heading = $derived(
		step === 0
			? 'A quieter tracker'
			: step === 1
				? 'About you'
				: redo
					? 'Save your answers'
					: 'How to start'
	);

	function pickGoal(id: Goal) {
		goal = id;
		if (id === 'glp1') glp1 = true;
	}

	function setGlp1(on: boolean) {
		glp1 = on;
		if (on) goal = 'glp1';
	}

	function toggleRestriction(id: Restriction) {
		restrictions = restrictions.includes(id)
			? restrictions.filter((x) => x !== id)
			: [...restrictions, id];
	}

	function finish(useSample: boolean) {
		const profile = emptyProfile({
			id: uid('p-'),
			name: name.trim() || 'You',
			goal: glp1 ? 'glp1' : goal,
			glp1: glp1 || goal === 'glp1',
			sex,
			age,
			heightCm,
			activity,
			restrictions,
			weights: [{ id: uid('w-'), date: todayISO(), kg }]
		});
		tend.completeOnboarding({ profile, household: false, useSample });
	}

	/**
	 * The redo path: patches only the answered fields onto the existing
	 * active profile. Unlike `finish`, this never touches `log`, `weights`,
	 * `injections`, any override, or any other household profile — those
	 * are not onboarding answers, and `patchActive` merges rather than
	 * replaces.
	 */
	function saveRedo() {
		tend.patchActive((p) => ({
			...p,
			name: name.trim() || 'You',
			goal: glp1 ? 'glp1' : goal,
			glp1: glp1 || goal === 'glp1',
			sex,
			age,
			heightCm,
			activity,
			restrictions
		}));
		onredo?.();
	}
</script>

<main
	class="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-10"
>
	<p class="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">{heading}</p>

	{#if step === 0}
		<div class="flex flex-1 flex-col">
			<div class="bg-primary mt-10 flex size-16 items-end justify-center rounded-2xl pb-2">
				<svg viewBox="0 0 32 18" class="text-primary-foreground w-10" aria-hidden="true">
					<path
						d="M4 2h24M4 2c.6 10 4.5 14 12 14S27.4 12 28 2"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
					/>
				</svg>
			</div>
			<h1 class="font-display mt-8 text-5xl tracking-tight">Tend</h1>
			<p class="text-muted-foreground mt-3 text-lg">The tracker that doesn’t guilt you.</p>
			<ul class="text-foreground mt-10 flex flex-col gap-5 text-[0.95rem] leading-relaxed">
				<li>
					<strong class="font-medium">No red days.</strong> A missed log is just a day. Weeks still count.
				</li>
				<li>
					<strong class="font-medium">Proposals, not verdicts.</strong> Type a sentence, or search the
					catalog.
				</li>
				<li>
					<strong class="font-medium">Data stays here.</strong> No ads, no brokers. Export or delete in
					one tap.
				</li>
			</ul>
			<div class="mt-auto pt-10">
				<Button class="w-full" size="lg" onclick={() => (step = 1)}>Continue</Button>
			</div>
		</div>
	{:else if step === 1}
		<div class="flex flex-1 flex-col gap-5 pt-6">
			<h1 class="font-display text-3xl tracking-tight">A few quiet facts.</h1>

			<div>
				<Label for="onboard-name">Name</Label>
				<Input id="onboard-name" class="mt-1.5" bind:value={name} />
			</div>

			<div>
				<p class="text-muted-foreground text-sm font-medium">Aim</p>
				<div class="mt-2 grid grid-cols-2 gap-2">
					{#each GOALS as g (g.id)}
						<ToggleButton
							pressed={goal === g.id}
							onclick={() => pickGoal(g.id)}
							resting="bg-card"
							class="rounded-2xl px-3 py-3 text-left"
						>
							<span class="block font-medium">{g.label}</span>
							<span class="block text-xs {goal === g.id ? 'opacity-80' : 'text-muted-foreground'}">
								{g.hint}
							</span>
						</ToggleButton>
					{/each}
				</div>
			</div>

			<div class="bg-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
				<div>
					<p class="font-medium">GLP-1 mode</p>
					<p class="text-muted-foreground text-xs">Protein and fiber first. Calories quieter.</p>
				</div>
				<Switch aria-label="GLP-1 mode" bind:checked={() => glp1, setGlp1} />
			</div>

			<div class="grid {redo ? 'grid-cols-2' : 'grid-cols-3'} gap-2">
				<div>
					<Label for="onboard-age">Age</Label>
					<Input id="onboard-age" class="mt-1.5" type="number" bind:value={age} />
				</div>
				{#if units === 'imperial'}
					<div>
						<Label for="onboard-height-ft">Height ft, in</Label>
						<div class="mt-1.5 flex gap-1">
							<Input
								id="onboard-height-ft"
								type="number"
								aria-label="Height, feet"
								bind:value={() => heightFeetInches.feet, (v) => setHeightFeet(String(v))}
							/>
							<Input
								id="onboard-height-in"
								type="number"
								aria-label="Height, inches"
								bind:value={() => heightFeetInches.inches, (v) => setHeightInches(String(v))}
							/>
						</div>
					</div>
					{#if !redo}
						<div>
							<Label for="onboard-weight">Weight lb</Label>
							<Input
								id="onboard-weight"
								class="mt-1.5"
								type="number"
								bind:value={() => weightDisplay, (v) => setWeightDisplay(String(v))}
							/>
						</div>
					{/if}
				{:else}
					<div>
						<Label for="onboard-height">Height cm</Label>
						<Input
							id="onboard-height"
							class="mt-1.5"
							type="number"
							bind:value={() => Math.round(heightCm), (v) => setHeightCm(String(v))}
						/>
					</div>
					{#if !redo}
						<div>
							<Label for="onboard-weight">Weight kg</Label>
							<Input
								id="onboard-weight"
								class="mt-1.5"
								type="number"
								bind:value={() => weightDisplay, (v) => setWeightDisplay(String(v))}
							/>
						</div>
					{/if}
				{/if}
			</div>

			<div>
				<p class="text-muted-foreground text-sm font-medium">Sex (for formula TDEE)</p>
				<div class="mt-2 flex gap-2">
					{#each SEXES as s (s)}
						<ToggleButton
							pressed={sex === s}
							tone="inverse"
							onclick={() => (sex = s)}
							resting="bg-card"
							class="h-10 flex-1 rounded-xl capitalize"
						>
							{s}
						</ToggleButton>
					{/each}
				</div>
			</div>

			<div>
				<p class="text-muted-foreground text-sm font-medium">Movement</p>
				<div class="mt-2 grid grid-cols-2 gap-2">
					{#each ACTIVITIES as a (a.id)}
						<ToggleButton
							pressed={activity === a.id}
							tone="inverse"
							onclick={() => (activity = a.id)}
							resting="bg-card"
							class="h-11 rounded-xl text-sm"
						>
							{a.label}
						</ToggleButton>
					{/each}
				</div>
			</div>

			<div>
				<p class="text-muted-foreground text-sm font-medium">Dietary filters</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each RESTRICTIONS as r (r.id)}
						{@const on = restrictions.includes(r.id)}
						<ToggleButton
							pressed={on}
							onclick={() => toggleRestriction(r.id)}
							resting="bg-card"
							class="h-9 rounded-full px-3 text-sm"
						>
							{r.label}
						</ToggleButton>
					{/each}
				</div>
			</div>

			<div
				class="border-border bg-background/95 sticky bottom-0 -mx-5 mt-auto border-t px-5 py-3 backdrop-blur-sm"
			>
				<div class="flex gap-2">
					<Button
						variant="secondary"
						class="flex-1"
						onclick={() => (redo ? onredo?.() : (step = 0))}
					>
						{redo ? 'Cancel' : 'Back'}
					</Button>
					<Button class="flex-1" onclick={() => (step = 2)}>Continue</Button>
				</div>
			</div>
		</div>
	{:else if redo}
		<div class="flex flex-1 flex-col pt-6">
			<h1 class="font-display text-3xl tracking-tight">Save your updated answers.</h1>
			<p class="text-muted-foreground mt-3">
				This only changes the answers above. Your log, weight history and workouts are untouched.
			</p>
			<div class="mt-auto flex flex-col gap-2 pt-10">
				<Button size="lg" class="w-full" onclick={saveRedo}>Save</Button>
				<Button size="lg" variant="secondary" class="w-full" onclick={() => onredo?.()}>
					Cancel
				</Button>
			</div>
		</div>
	{:else}
		<div class="flex flex-1 flex-col pt-6">
			<h1 class="font-display text-3xl tracking-tight">
				Start with a lived-in journal, or a blank one.
			</h1>
			<p class="text-muted-foreground mt-3">
				Sample data lets you feel adaptive TDEE, micronutrients, and a week of meals immediately.
				Nothing leaves this device.
			</p>
			<div class="mt-auto flex flex-col gap-2 pt-10">
				<Button size="lg" class="w-full" onclick={() => finish(true)}>
					Open the sample journal
				</Button>
				<Button size="lg" variant="secondary" class="w-full" onclick={() => finish(false)}>
					Start empty
				</Button>
			</div>
		</div>
	{/if}
</main>

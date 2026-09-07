<script lang="ts">
	import List from '@lucide/svelte/icons/list';
	import { resolve } from '$app/paths';
	import { routineTotals } from '$lib/domain/exercises';
	import { routineIdsOn } from '$lib/domain/planned-days';
	import type { PlannedDay, Routine, Workout } from '$lib/domain/types';
	import { startOfWeek } from '$lib/domain/utils';
	import { countsAsTraining } from '$lib/domain/workout';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Button from '$lib/ui/Button.svelte';

	/**
	 * What today asks for is what was put on today in the planner — nothing more
	 * is inferred. A day can hold more than one session, so the card leads with
	 * the first and names the rest in order; a day with nothing on it is a rest
	 * day, and with no routines at all the card says so instead.
	 */
	let {
		routines,
		plan,
		workouts,
		today,
		onstart,
		onpick,
		onopen
	}: {
		routines: Routine[];
		plan: PlannedDay[];
		/** Filed workouts, so a rest day can say what the week already holds. */
		workouts: Workout[];
		today: string;
		onstart: (routineId: string) => void;
		/** Opens the shelf of starter routines. */
		onpick: () => void;
		/** Opens a blank routine in the builder. */
		onopen: () => void;
	} = $props();

	/**
	 * "Has history, no routines left" — reachable once a rotation is deleted.
	 * First run (no routines, no history) is a different branch and shows the
	 * template shelf instead.
	 */
	const nothingYet = $derived(routines.length === 0);

	/** Today's sessions, in the order the day was planned. */
	const planned = $derived(
		routineIdsOn(plan, today).flatMap((id) => routines.filter((r) => r.id === id))
	);

	const routine = $derived(planned[0]);

	/** The sessions after the first, named so the day reads in full. */
	const later = $derived(
		planned.slice(1).map((r) => ({ id: r.id, name: r.name, totals: routineTotals(r) }))
	);

	/** Training anyway on a rest day trains the first routine in the rotation. */
	const anyway = $derived(routines[0]);

	/**
	 * `startWorkout` refuses a routine with no movements, so its run control is
	 * disabled rather than left looking live.
	 */
	function runnable(r: Routine | undefined) {
		return r !== undefined && r.exercises.length > 0;
	}

	/**
	 * Sessions actually trained this week; one walked out of with nothing ticked
	 * doesn't count.
	 */
	const doneThisWeek = $derived(
		workouts.filter((w) => w.date >= startOfWeek(today) && w.date <= today && countsAsTraining(w))
			.length
	);

	const restMeta = $derived.by(() => {
		const scheduled = 'The calendar has nothing scheduled.';
		if (doneThisWeek === 0) return scheduled;
		const sessions = doneThisWeek === 1 ? 'session' : 'sessions';
		return `${scheduled} ${doneThisWeek} ${sessions} done this week already.`;
	});

	const head = $derived.by(() => {
		if (nothingYet)
			return {
				kicker: 'Today',
				title: 'No routines yet',
				meta: 'A routine is the list of exercises for one session. Start from a template, or build your own.'
			};
		if (!routine) return { kicker: 'Today', title: 'Rest day', meta: restMeta };
		const totals = routineTotals(routine);
		return {
			kicker: later.length > 0 ? 'Today’s sessions' : 'Today’s session',
			title: routine.name,
			meta: `${totals.exercises} exercises · ${totals.sets} sets · about ${totals.minutes} min`
		};
	});
</script>

<section class="bg-card rounded-3xl p-4 shadow-border">
	<SectionLabel>{head.kicker}</SectionLabel>
	<h2 class="font-display mt-1.5 text-2xl tracking-tight">{head.title}</h2>
	<p class="text-muted-foreground mt-2 text-sm">{head.meta}</p>

	{#if nothingYet}
		<div class="mt-4 flex gap-2">
			<Button size="lg" class="flex-1" onclick={onpick}>Pick a starter</Button>
			<Button variant="outline" size="lg" class="shrink-0" onclick={onopen}>Build one</Button>
		</div>
	{:else if routine}
		<div class="mt-3.5 flex flex-wrap gap-1.5">
			<!-- Keyed by position, not name: the same movement can appear twice, and duplicate keys are a runtime error. -->
			{#each routine.exercises.slice(0, 4) as exercise, index (index)}
				<span class="bg-secondary text-foreground/70 rounded-full px-2.5 py-1 text-xs">
					{exercise.name}
				</span>
			{/each}
		</div>
		{#if later.length > 0}
			<!-- Named, not run from here: any of them can be started from the rotation below,
			     and a second control for the same thing is a second thing to read. -->
			<ol class="border-border mt-3.5 flex flex-col gap-1 border-t pt-3">
				{#each later as session (session.id)}
					<li class="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
						<span class="text-foreground truncate">then {session.name}</span>
						<span class="shrink-0">
							{session.totals.exercises} exercises · {session.totals.sets} sets
						</span>
					</li>
				{/each}
			</ol>
		{/if}
		<div class="mt-4 flex gap-2">
			<Button
				size="lg"
				class="flex-1"
				disabled={!runnable(routine)}
				onclick={() => onstart(routine.id)}
			>
				Start session
			</Button>
			<a
				href={resolve('/exercise/routines/[id]', { id: routine.id })}
				aria-label="See the whole routine"
				class="border-border text-foreground hover:bg-secondary flex size-12 shrink-0 items-center justify-center rounded-2xl border"
			>
				<List class="size-4" />
			</a>
		</div>
	{:else}
		<div class="mt-4 flex gap-2">
			<a
				href={resolve('/exercise/plan')}
				class="border-border text-foreground hover:bg-secondary flex h-12 flex-1 items-center justify-center rounded-2xl border text-sm"
			>
				Change the plan
			</a>
			<Button
				variant="secondary"
				size="lg"
				class="flex-1"
				disabled={!runnable(anyway)}
				onclick={() => anyway && onstart(anyway.id)}
			>
				Train anyway
			</Button>
		</div>
	{/if}
</section>

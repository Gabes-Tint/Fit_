import { buildGrocery } from '../../src/lib/domain/grocery.ts';
import { recipeMacros, RECIPE_BY_ID } from '../../src/lib/domain/recipes.ts';
import {
	calmWeeks,
	computeTargets,
	latestWeight,
	microTargets,
	rollingAverages
} from '../../src/lib/domain/tdee.ts';
import { heightToFeetInches } from '../../src/lib/domain/units.ts';
import type { TendState } from '../../src/lib/domain/types.ts';
import { ANCHOR_DATE, scaledState } from './sync-payload.ts';
import { median, percentile } from './stats.ts';

/**
 * What one render of `/progress`, `/plan` and `/you` costs in journal work, at
 * the scales an account reaches.
 *
 * The sibling of `perf:today-log`, and it exists to answer that instrument's
 * handoff question: whether the `{@const}` fan-out it found on Today repeats on
 * the three heaviest routes. It does not, and the shape of these three
 * functions is the finding rather than a preamble to one — each route's reads
 * are `$derived`, which is memoized per dependency, not `{@const}` inside an
 * `{#if}`, which re-runs wholesale. So the question here is only what the
 * domain functions themselves cost.
 *
 * Each function below makes exactly the calls its route's `$derived` bindings
 * make, in the order the module makes them, so that a number here is
 * attributable to a line of the route rather than to this file's idea of one.
 *
 * Like `today-log`, this measures *less* than a browser — plain arrays, no
 * `$state` proxy, no DOM, no components — so every number is a floor. What it
 * buys for that is a spread small enough to judge a change by.
 *
 * Under `bun` for the same reason `perf:sync-payload` is: it builds documents
 * out of `src/lib/domain`, whose modules import each other without file
 * extensions.
 */

/** How many renders are timed at each scale. */
const RENDERS = 200;

/** Journals the table reports, and what account they belong to. */
const SCALES = [
	{ label: 'a month', days: 30 },
	{ label: 'a year', days: 365 },
	{ label: 'three years', days: 1095 }
];

/**
 * `/progress`: four `$derived` bindings over the journal, plus the weight
 * reading the Weight card shows. `end` is passed explicitly because the
 * generated journals end at `ANCHOR_DATE` rather than the wall clock, and a
 * rolling week that found nothing logged would be measuring an abandoned
 * account.
 */
function progressRender(state: TendState): number {
	const profile = state.profiles[0];
	if (profile === undefined) throw new Error('the generated state has no profile');
	const started = performance.now();
	computeTargets(profile);
	rollingAverages(profile.log, 7, ANCHOR_DATE);
	microTargets(profile);
	calmWeeks(profile.log, 4, ANCHOR_DATE);
	latestWeight(profile.weights);
	return performance.now() - started;
}

/**
 * `/plan`: the grocery build and the per-slot recipe macros. Reads no journal
 * at all — the week plan is twenty-one slots whatever the log has grown to —
 * so this row is here to hold that claim to a measurement rather than to a
 * reading of the module.
 */
function planRender(state: TendState): number {
	const started = performance.now();
	buildGrocery(state.weekPlan, state.pantry);
	for (const slot of state.weekPlan) {
		const recipe = RECIPE_BY_ID[slot.recipeId];
		if (recipe) recipeMacros(recipe);
	}
	return performance.now() - started;
}

/** `/you`: `computeTargets` and the height reading, and nothing else. */
function youRender(state: TendState): number {
	const profile = state.profiles[0];
	if (profile === undefined) throw new Error('the generated state has no profile');
	const started = performance.now();
	computeTargets(profile);
	heightToFeetInches(profile.heightCm);
	return performance.now() - started;
}

const ROUTES = [
	{ label: '/progress', render: progressRender },
	{ label: '/plan', render: planRender },
	{ label: '/you', render: youRender }
];

function main(): void {
	console.log('| route | journal | entries | p50 | p95 | mean |');
	console.log('| --- | --- | --- | --- | --- | --- |');
	for (const route of ROUTES) {
		for (const scale of SCALES) {
			const state = scaledState({ days: scale.days, training: true });
			const entries = state.profiles[0]?.log.length ?? 0;
			// Warm: shapes settled and arrays paged in before anything counts.
			for (let i = 0; i < 20; i += 1) route.render(state);
			const samples: number[] = [];
			for (let i = 0; i < RENDERS; i += 1) samples.push(route.render(state));
			const mean = samples.reduce((total, each) => total + each, 0) / samples.length;
			console.log(
				`| ${route.label} | ${scale.label} | ${entries} | ${median(samples).toFixed(3)} ms | ` +
					`${percentile(samples, 0.95).toFixed(3)} ms | ${mean.toFixed(3)} ms |`
			);
		}
	}
}

main();

import {
	computeTargets,
	loggedDatesSet,
	nutritionForDay,
	rollingAverages
} from '../../src/lib/domain/tdee.ts';
import { ANCHOR_DATE, scaledState } from './sync-payload.ts';
import { median, percentile } from './stats.ts';

/**
 * The journal work one Today render does, at the scales an account reaches.
 *
 * `TodayView.svelte` computes its cards from `{@const}` bindings inside the
 * `{#if profile}` block, so every one of them re-runs whenever anything the
 * block depends on changes — the selected day on the week strip, a food
 * logged, the weight card opening. Four of those bindings read the whole
 * journal:
 *
 * ```
 * {@const dayTotals = nutritionForDay(profile.log, day)}   // 1 full scan
 * {@const week = rollingAverages(profile.log, 7)}          // 7 full scans
 * {@const food = loggedDatesSet(profile.log)}              // 1 full scan
 * {@const items = profile.log.filter((i) => i.date === day)} // 1 full scan
 * ```
 *
 * `rollingAverages` is the seven because it asks `dayTotals` for each of the
 * last seven dates and `dayTotals` filters the whole journal for each one. So
 * a render costs ten passes over a journal that only grows.
 *
 * This measures those five calls together, as the template makes them, over
 * documents built by the sync-payload instrument (`sync-payload.ts`) — the
 * demo seed's own journal stretched to a month, a year and three years, so
 * the entries are the application's food and macros rather than this file's
 * invention.
 *
 * It measures *less* than a browser: no proxy reads, no DOM, no components.
 * Svelte's `$state` puts every one of these array reads behind a proxy, so
 * the browser pays more than the number here, never less. What it buys for
 * that is a spread under a tenth of a millisecond, which is what a change
 * worth a few milliseconds has to be judged against.
 *
 * Under `bun` for the same reason `perf:sync-payload` is: it builds its
 * documents out of `src/lib/domain`, whose modules import each other without
 * file extensions.
 */

/** How many renders are timed at each scale. */
const RENDERS = 200;

/** Journals the table reports, and what a real account they belong to looks like. */
const SCALES = [
	{ label: 'a month', days: 30 },
	{ label: 'a year', days: 365 },
	{ label: 'three years', days: 1095 }
];

/**
 * The five journal reads `TodayView.svelte` makes, in the order it makes
 * them. `end` is passed explicitly because the generated journals end at
 * `ANCHOR_DATE` rather than the wall clock, and a rolling week that found
 * nothing logged would be measuring an account that stopped using the app.
 */
function todayRender(state: ReturnType<typeof scaledState>, day: string): number {
	const profile = state.profiles[0];
	if (profile === undefined) throw new Error('the generated state has no profile');
	const started = performance.now();
	computeTargets(profile);
	nutritionForDay(profile.log, day);
	rollingAverages(profile.log, 7, day);
	loggedDatesSet(profile.log);
	profile.log.filter((entry) => entry.date === day);
	return performance.now() - started;
}

function main(): void {
	console.log('| journal | entries | render p50 | p95 | mean |');
	console.log('| --- | --- | --- | --- | --- |');
	for (const scale of SCALES) {
		const state = scaledState({ days: scale.days, training: true });
		const entries = state.profiles[0]?.log.length ?? 0;
		// Warm: the shapes settled and the arrays paged in before anything counts.
		for (let i = 0; i < 20; i += 1) todayRender(state, ANCHOR_DATE);
		const samples: number[] = [];
		for (let i = 0; i < RENDERS; i += 1) samples.push(todayRender(state, ANCHOR_DATE));
		const mean = samples.reduce((total, each) => total + each, 0) / samples.length;
		console.log(
			`| ${scale.label} | ${entries} | ${median(samples).toFixed(3)} ms | ` +
				`${percentile(samples, 0.95).toFixed(3)} ms | ${mean.toFixed(3)} ms |`
		);
	}
}

main();

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/**
 * Experiment instrument for issue #292 -- NOT part of the product or the gate.
 *
 * #292 needs the per-action actionability wait on `mobile-safari`, which the
 * issue read out of a retry trace. Turning `trace` on for every test would
 * change the thing being measured: WebKit's trace capture snapshots the DOM per
 * action, so the variant runs would be compared under an overhead that is
 * itself action-shaped. Playwright already times every action for us -- each
 * `locator.click` is a `pw:api` step with a duration -- so this reporter reads
 * that and costs nothing.
 *
 * Prints one `ACTION_TIMINGS <json>` line so a run log is enough to read the
 * result; the artifact store is at its quota (see `upload-report`).
 */

/**
 * Playwright 1.62 titles a `pw:api` step in prose -- `Click getByRole(...)`,
 * `Fill "egg" getByLabel(...)` -- not as the method name. These are the steps
 * that go through the actionability wait #292 is about; `Navigate to` is kept
 * apart as the control, since the issue measured `page.goto` at 93 ms while
 * the actions around it cost seconds.
 */
const ACTION_TITLE =
	/^(?:Click|Double click|Fill|Press|Tap|Check|Uncheck|Hover|Select|Type|Set input files|Focus|Drag)\b/;
const NAVIGATION_TITLE = /^(?:Navigate to|Reload|Go back|Go forward)\b/;

type Sample = { readonly title: string; readonly ms: number };

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function quantile(values: readonly number[], q: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
	return sorted[index] ?? 0;
}

export default class ActionTimingReporter implements Reporter {
	private readonly actions: Sample[] = [];
	private readonly navigations: Sample[] = [];
	private readonly apiSteps: Sample[] = [];
	private tests = 0;
	private startedAt = 0;

	onBegin(): void {
		this.startedAt = Date.now();
	}

	onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
		if (step.category !== 'pw:api') return;
		const sample: Sample = { title: step.title, ms: step.duration };
		this.apiSteps.push(sample);
		if (ACTION_TITLE.test(step.title)) this.actions.push(sample);
		else if (NAVIGATION_TITLE.test(step.title)) this.navigations.push(sample);
	}

	onTestEnd(): void {
		this.tests += 1;
	}

	onEnd(): void {
		const wallMs = Date.now() - this.startedAt;
		const actionMs = this.actions.map((sample) => sample.ms);
		const navigationMs = this.navigations.map((sample) => sample.ms);
		const summary = {
			project: process.env.E2E_PROJECT ?? 'default',
			variant: process.env.EXP_VARIANT ?? 'unlabelled',
			tests: this.tests,
			suiteWallMs: wallMs,
			actions: actionMs.length,
			actionMedianMs: Math.round(median(actionMs)),
			actionMeanMs:
				actionMs.length === 0
					? 0
					: Math.round(actionMs.reduce((a, b) => a + b, 0) / actionMs.length),
			actionP90Ms: Math.round(quantile(actionMs, 0.9)),
			actionMaxMs: actionMs.length === 0 ? 0 : Math.round(Math.max(...actionMs)),
			actionTotalMs: Math.round(actionMs.reduce((a, b) => a + b, 0)),
			navigations: navigationMs.length,
			navigationMedianMs: Math.round(median(navigationMs))
		};
		const outDir = path.join(process.cwd(), 'reports', 'quality');
		mkdirSync(outDir, { recursive: true });
		writeFileSync(
			path.join(outDir, 'action-timings.json'),
			JSON.stringify({ summary, samples: this.apiSteps }, null, 2)
		);
		process.stdout.write(`\nACTION_TIMINGS ${JSON.stringify(summary)}\n`);
	}
}

import { describe, expect, it } from 'vitest';
import { buildVerifyChangedPlan, type VerifyChangedPlanInput } from './verify-changed-plan';

const STATIC_STEPS = ['format:check', 'lint', 'check', 'check:thresholds'];

function input(overrides: Partial<VerifyChangedPlanInput>): VerifyChangedPlanInput {
	return {
		changed: [],
		staticSteps: STATIC_STEPS,
		siblingSpecs: () => [],
		importingSpecs: () => [],
		exists: () => false,
		projectFor: () => 'client',
		isMutated: () => false,
		allBrowsers: false,
		...overrides
	};
}

describe('buildVerifyChangedPlan', () => {
	it('always runs the static steps', () => {
		const plan = buildVerifyChangedPlan(input({}));
		expect(plan.steps).toEqual(
			STATIC_STEPS.map((name) => ({ category: 'static', name, reason: 'always' }))
		);
	});

	it('a .svelte-only change under components: no mutation, build yes, sibling spec, full e2e suite', () => {
		const file = 'src/lib/components/Widget.svelte';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				siblingSpecs: (f) => (f === file ? ['src/lib/components/Widget.svelte.spec.ts'] : []),
				projectFor: () => 'client',
				isMutated: () => false
			})
		);
		const categories = plan.steps.map((step) => step.category);
		expect(categories).not.toContain('mutation');
		expect(categories).toContain('build');
		expect(plan.steps).toContainEqual(
			expect.objectContaining({
				category: 'spec',
				name: 'src/lib/components/Widget.svelte.spec.ts',
				project: 'client'
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'e2e', name: 'full suite' })
		);
		// Only one e2e entry: the full suite, not a per-file guess.
		expect(plan.steps.filter((step) => step.category === 'e2e')).toHaveLength(1);
	});

	it('a src/lib/server/** change: security mutation lane, no build', () => {
		const file = 'src/lib/server/users/session.ts';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				isMutated: (f) => f === file
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'mutation', name: 'security' })
		);
		expect(plan.steps.some((step) => step.category === 'build')).toBe(false);
	});

	it('a scripts/**-only change: static and its spec, no build, no e2e, no mutation', () => {
		const file = 'scripts/quality/example.ts';
		const spec = 'scripts/quality/example.spec.ts';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				siblingSpecs: (f) => (f === file ? [spec] : []),
				projectFor: () => 'server'
			})
		);
		const categories = plan.steps.map((step) => step.category);
		expect(categories).not.toContain('build');
		expect(categories).not.toContain('e2e');
		expect(categories).not.toContain('mutation');
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'spec', name: spec, project: 'server' })
		);
	});

	it('a docs-only change: static steps only', () => {
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: 'README.md', status: 'M' }]
			})
		);
		expect(plan.steps).toEqual(
			STATIC_STEPS.map((name) => ({ category: 'static', name, reason: 'always' }))
		);
	});

	it('a quality/bundle-budgets.json change: build and bundle run', () => {
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: 'quality/bundle-budgets.json', status: 'M' }]
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'build', name: 'build' })
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'build', name: 'check:bundle' })
		);
	});

	it('maps a changed route file to its route e2e spec', () => {
		const file = 'src/routes/you/+page.svelte';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				exists: (candidate) => candidate === 'src/routes/you.e2e.ts'
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'e2e', name: 'src/routes/you.e2e.ts' })
		);
	});

	it('collects a spec that imports a changed file, alongside its sibling', () => {
		const file = 'src/lib/domain/tdee.ts';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				siblingSpecs: (f) => (f === file ? ['src/lib/domain/tdee.spec.ts'] : []),
				importingSpecs: (f) => (f === file ? ['src/lib/domain/plan.spec.ts'] : []),
				projectFor: () => 'server'
			})
		);
		expect(plan.steps.filter((step) => step.category === 'spec').map((step) => step.name)).toEqual(
			expect.arrayContaining(['src/lib/domain/tdee.spec.ts', 'src/lib/domain/plan.spec.ts'])
		);
	});

	it('runs a changed spec directly rather than searching for a sibling', () => {
		const file = 'src/lib/domain/tdee.spec.ts';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'M' }],
				projectFor: () => 'server'
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'spec', name: file, reason: 'changed directly' })
		);
	});

	it('a changed .e2e.ts file runs as an e2e step, never as a vitest spec (#152)', () => {
		const file = 'src/routes/phone-layout.e2e.ts';
		const plan = buildVerifyChangedPlan(
			input({
				changed: [{ path: file, status: 'A' }],
				projectFor: () => 'client'
			})
		);
		expect(plan.steps).toContainEqual(
			expect.objectContaining({ category: 'e2e', name: file, reason: 'changed directly' })
		);
		expect(plan.steps.filter((step) => step.category === 'spec')).toEqual([]);
	});

	it('--all-browsers widens the e2e project', () => {
		const plan = buildVerifyChangedPlan(input({ allBrowsers: true }));
		expect(plan.e2eProject).toBe('all');
	});
});

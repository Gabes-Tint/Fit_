export interface GateStep {
	/** npm script name, used as the log file name and the `--only` selector. */
	name: string;
	/** Human-readable purpose, printed in the summary table. */
	purpose: string;
	/** Machine-readable artifacts this step writes, relative to the project root. */
	artifacts?: string[];
	/**
	 * Holds no exclusive resource, reads no artifact a peer step writes, and
	 * binds no port. Opt-in, so a new step is sequential until checked.
	 */
	concurrent?: boolean;
	/** Requires a running Docker daemon. */
	docker?: boolean;
	/** Launches a real browser. */
	browser?: boolean;
}

/** Ring 2/3: no Docker, no browser. Safe for a pre-commit or per-edit loop. */
const staticSteps: GateStep[] = [
	{ name: 'format:check', purpose: 'Prettier formatting', concurrent: true },
	{
		name: 'lint',
		purpose: 'Type-aware ESLint',
		artifacts: ['reports/quality/eslint.json'],
		concurrent: true
	},
	{ name: 'lint:docs', purpose: 'Markdown lint', concurrent: true },
	{ name: 'spellcheck', purpose: 'Spelling', concurrent: true },
	{ name: 'check', purpose: 'Svelte and TypeScript types', concurrent: true },
	{ name: 'check:scripts', purpose: 'Script types', concurrent: true },
	{
		name: 'check:suppressions',
		purpose: 'Suppression ratchet',
		artifacts: ['reports/quality/suppressions.json'],
		concurrent: true
	},
	{ name: 'check:thresholds', purpose: 'Threshold guard', concurrent: true },
	{ name: 'check:mutation-reviews', purpose: 'Exact mutation-review ledger', concurrent: true },
	{
		name: 'check:mutation-oracle',
		purpose: 'Mutated client files stay measurable',
		concurrent: true
	},
	{
		name: 'check:mutation-scope',
		purpose: 'Files outside the mutation lanes stay on the ledger',
		concurrent: true
	},
	{ name: 'check:ci-contract', purpose: 'Local and hosted CI job parity', concurrent: true },
	{
		name: 'check:stale-revert',
		purpose: 'Branch does not revert recently merged work',
		concurrent: true
	},
	{
		name: 'check:schedules',
		purpose: 'Non-blocking tiers still run on a schedule',
		concurrent: true
	},
	{ name: 'knip', purpose: 'Unused files, exports, dependencies', concurrent: true },
	{
		name: 'duplicates',
		purpose: 'Copy-paste detection',
		artifacts: ['reports/quality/duplication/jscpd-report.json'],
		concurrent: true
	}
];

/** Ring 3 tail: compiles the app and measures the emitted client bundle. */
const buildSteps: GateStep[] = [
	{ name: 'build', purpose: 'Production build' },
	{
		name: 'check:bundle',
		purpose: 'Bundle byte budgets',
		artifacts: ['reports/quality/bundle/bundle-budget.json']
	}
];

const workflowStep: GateStep = {
	name: 'check:workflows',
	purpose: 'GitHub Actions lint',
	artifacts: ['reports/quality/actionlint.json'],
	docker: true
};

const coverageStep: GateStep = {
	name: 'test:coverage',
	purpose: 'Unit and component coverage',
	artifacts: ['coverage/client/coverage-summary.json', 'coverage/server/coverage-summary.json'],
	browser: true
};

const securityMutationStep: GateStep = {
	name: 'test:mutation:security',
	purpose: 'Security mutation strength',
	artifacts: [
		'reports/mutation/security/scope.json',
		'reports/mutation/security/mutation.json',
		'reports/mutation/security/verdict.json'
	]
};

const changedNodeMutationStep: GateStep = {
	name: 'test:mutation:changed:node',
	purpose: 'Changed Node mutation strength',
	artifacts: [
		'reports/mutation/changed-node/scope.json',
		'reports/mutation/changed-node/mutation.json',
		'reports/mutation/changed-node/verdict.json'
	]
};

const changedClientMutationStep: GateStep = {
	name: 'test:mutation:changed:client',
	purpose: 'Changed client mutation strength',
	artifacts: [
		'reports/mutation/changed-client/scope.json',
		'reports/mutation/changed-client/mutation.json',
		'reports/mutation/changed-client/verdict.json'
	],
	browser: true
};

/**
 * The one mutation lane that still blocks a merge. Gabriel's call, 2026-09-04:
 * the authentication boundary is where a test that fails to assert is a
 * security risk rather than a maintenance cost, and cold it is the cheapest
 * lane of the four at 3m50.
 */
const mergeGateMutationSteps = [securityMutationStep];

const fullMutationStep: GateStep = {
	name: 'test:mutation:full',
	purpose: 'Full mutation audit',
	artifacts: [
		'reports/mutation/full/scope.json',
		'reports/mutation/full/mutation.json',
		'reports/mutation/full/verdict.json'
	],
	browser: true
};

/**
 * Off the pull-request matrix since 2026-09-04, by the product owner, to cut
 * runner minutes: cold they cost 2m34, 8m51 and 18m07, and none of them was the
 * critical path. The changed lanes judge a diff and the full lane re-verifies
 * untouched code, so a schedule can ask both questions once a day instead of
 * once a push. They report debt now; they do not gate. See QUALITY.md.
 */
const scheduledMutationSteps = [
	changedNodeMutationStep,
	changedClientMutationStep,
	fullMutationStep
];

const selfTestStep: GateStep = {
	name: 'test:gates',
	purpose: 'Gate fixture self-test',
	artifacts: ['reports/quality/self-test.json'],
	docker: true
};

const e2eStep: GateStep = {
	name: 'test:e2e',
	purpose: 'End-to-end flows',
	artifacts: ['reports/quality/playwright.json'],
	browser: true
};

/** Deterministic, code-derived scanners. These block a merge. */
const blockingSecuritySteps: GateStep[] = [
	{
		name: 'security:gitleaks',
		purpose: 'Secrets in tree and history',
		artifacts: ['reports/security/gitleaks/'],
		docker: true
	},
	{
		name: 'security:semgrep',
		purpose: 'Hash-locked source rules',
		artifacts: ['reports/security/semgrep/semgrep.json'],
		docker: true
	}
];

/**
 * Feed-derived, so their findings change without a code change and they cannot
 * gate a merge; they run on a schedule instead (nightly.yml).
 */
const advisorySecuritySteps: GateStep[] = [
	{
		name: 'security:trivy',
		purpose: 'Dependency and config vulnerabilities',
		artifacts: ['reports/security/trivy/trivy.json'],
		docker: true
	},
	{
		name: 'test:e2e:security',
		purpose: 'ZAP-proxied browser flows',
		artifacts: ['reports/security/zap/'],
		docker: true,
		browser: true
	}
];

/**
 * The one list of CI steps: `tiers.ci` derives from this map, and the workflow
 * selects a slice with `--job` instead of repeating a step list.
 */
export const ciJobs = {
	static: [...staticSteps, workflowStep],
	unit: [coverageStep],
	'mutation-security': [securityMutationStep],
	build: buildSteps,
	e2e: [e2eStep],
	security: blockingSecuritySteps,
	'self-test': [selfTestStep]
} satisfies Record<string, GateStep[]>;

export type CiJobName = keyof typeof ciJobs;

export function isCiJobName(value: string): value is CiJobName {
	return Object.hasOwn(ciJobs, value);
}

const ciSteps = Object.values(ciJobs).flat();

export const tiers = {
	/** Ring 3. Everything that needs neither Docker nor a browser. */
	'verify:fast': [
		...staticSteps,
		{
			name: 'test:unit:server',
			purpose: 'Server unit tests',
			artifacts: ['reports/quality/vitest-server.json'],
			concurrent: true
		}
	],
	/** Ring 3/4. The pre-push gate. */
	verify: [...staticSteps, workflowStep, coverageStep, ...buildSteps],
	/** Ring 4. Adds the slow behavior gates and the gate self-test. */
	'verify:deep': [
		...staticSteps,
		workflowStep,
		coverageStep,
		...mergeGateMutationSteps,
		...scheduledMutationSteps,
		...buildSteps,
		e2eStep,
		selfTestStep
	],
	/** Ring 4. The complete merge gate, and the exact set CI runs. */
	ci: ciSteps,
	/**
	 * The three lanes that left the pull-request path on 2026-09-04. Not a merge
	 * gate and not run per push: mutation-audit.yml runs them daily against
	 * `main` and reports the debt as an issue rather than failing anything.
	 * `check:schedules` proves that schedule and that issue path still exist.
	 */
	audit: scheduledMutationSteps,
	/** Ring 5. Scheduled, non-deterministic scanners. */
	nightly: advisorySecuritySteps
} satisfies Record<string, GateStep[]>;

export type TierName = keyof typeof tiers;

export function isTierName(value: string): value is TierName {
	return Object.hasOwn(tiers, value);
}

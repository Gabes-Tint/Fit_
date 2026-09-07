import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CRASH_EXIT_CODE } from './run-outcome';

/**
 * One deliberately broken input per gate. Fixtures are generated at run time
 * rather than committed: a stored fixture would trip the secret scanner, spell
 * checker, or linters on this repository, so offending literals are fragments
 * joined at run time.
 */

export interface GateFixture {
	name: string;
	/** The gate expected to fail. */
	gate: string;
	/** Gates that must pass first, in order. */
	prepare?: string[];
	description: string;
	docker?: boolean;
	browser?: boolean;
	/** Runs alone because this fixture owns a process-wide resource such as Stryker's sandbox. */
	exclusive?: boolean;
	/** Leave the generated file untracked to prove diff discovery cannot miss it. */
	stage?: boolean;
	/** Commit only support files, leaving the production defect outside the baseline. */
	baselinePaths?: string[];
	/** Text proving the gate rejected the intended defect instead of failing setup. */
	failureIncludes?: string;
	/** The exact status this failure mode must report, where the gate has more than one. */
	expectedExitCode?: number;
	apply: (root: string) => Promise<void>;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
	const target = path.join(root, relativePath);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, content);
}

async function edit(
	root: string,
	relativePath: string,
	change: (content: string) => string
): Promise<void> {
	const target = path.join(root, relativePath);
	await writeFile(target, change(await readFile(target, 'utf8')));
}

const duplicatedBlock = `export function normalize(values: number[], factor: number): number[] {
	const result: number[] = [];
	for (const value of values) {
		if (value > factor) {
			result.push(value * factor);
		} else if (value < -factor) {
			result.push(value / factor);
		} else {
			result.push(0);
		}
	}
	if (result.length === 0) {
		result.push(factor);
	}
	return result;
}
`;

export const fixtures: GateFixture[] = [
	{
		name: 'unformatted-source',
		gate: 'format:check',
		description: 'A source file that Prettier would reformat.',
		apply: (root) => write(root, 'src/lib/fixture.ts', 'export const value   =    1\n')
	},
	{
		name: 'explicit-any',
		gate: 'lint',
		description: 'An explicit any, which the type-aware ESLint config rejects.',
		apply: (root) =>
			write(
				root,
				'src/lib/fixture.ts',
				'export function identity(value: any) {\n\treturn value;\n}\n'
			)
	},
	{
		name: 'markdown-violation',
		gate: 'lint:docs',
		description: 'A Markdown file with a missing top-level heading and a hard tab.',
		apply: (root) => write(root, 'fixture.md', '##\tSkipped level\n\ntext\n')
	},
	{
		name: 'unknown-word',
		gate: 'spellcheck',
		description: 'A word no dictionary contains.',
		// Three-character fragments stay under the spell checker's minimum word length.
		apply: (root) =>
			write(root, 'src/lib/fixture.ts', `export const ${['zqf', 'lub', 'tyx'].join('')} = 1;\n`)
	},
	{
		name: 'type-error',
		gate: 'check',
		description: 'A type error in application source.',
		apply: (root) => write(root, 'src/lib/fixture.ts', "export const count: number = 'text';\n")
	},
	{
		name: 'script-type-error',
		gate: 'check:scripts',
		description: 'A type error in the scripts project.',
		apply: (root) => write(root, 'scripts/fixture.ts', "export const count: number = 'text';\n")
	},
	{
		name: 'unjustified-suppression',
		gate: 'check:suppressions',
		description: 'A suppression comment with no issue key or URL.',
		apply: (root) =>
			write(root, 'src/lib/fixture.ts', `/* eslint-${'disable'} */\nexport const value = 1;\n`)
	},
	{
		name: 'weakened-threshold',
		gate: 'check:thresholds',
		description: 'A coverage threshold lowered below the recorded baseline.',
		apply: (root) =>
			edit(root, 'quality/thresholds.json', (content) =>
				content.replace('"lines": 80', '"lines": 50')
			)
	},
	{
		name: 'weakened-mutation-policy',
		gate: 'check:thresholds',
		description: 'A security mutation floor lowered below the recorded baseline.',
		apply: (root) =>
			edit(root, 'quality/mutation-policy.json', (content) =>
				content.replace('"aggregateKilled": 95', '"aggregateKilled": 80')
			)
	},
	{
		name: 'missing-mutation-policy-limit',
		gate: 'check:thresholds',
		failureIncludes: 'mutation policy.changed must have exactly keys',
		description: 'A deleted mutation limit, which would otherwise make a comparison inert.',
		apply: (root) =>
			edit(root, 'quality/mutation-policy.json', (content) =>
				content.replace('\n\t\t"perFileKilled": 80,', '')
			)
	},
	{
		name: 'unmeasurable-mutated-file',
		gate: 'check:mutation-oracle',
		failureIncludes: 'no spec in DOM_FREE_CLIENT_SPECS reaches it',
		description:
			'A client module dropped out of the jsdom project, which would leave it mutated but measured by nothing.',
		apply: (root) =>
			edit(root, 'quality/dom-free-client-specs.mjs', (content) =>
				content.replace("\t'src/lib/ui/cn.svelte.spec.ts',\n", '')
			)
	},
	{
		name: 'broad-mutation-review',
		gate: 'check:mutation-reviews',
		failureIncludes: 'invalid reviewed-mutant entry',
		description: 'A wildcard mutation-review entry, which could hide unrelated survivors.',
		apply: (root) =>
			write(
				root,
				'quality/mutation-equivalents.json',
				`${JSON.stringify(
					{
						version: 1,
						entries: [
							{
								fingerprint: 'd8a68ede8dc5df50a92add195c047649daa7bcc46e8a885bc076882ea36f592f',
								file: 'src/**/*.ts',
								mutatorName: 'Any',
								replacement: 'true',
								location: {
									start: { line: 1, column: 0 },
									end: { line: 1, column: 1 }
								},
								sourceHash: '0'.repeat(64),
								classification: 'equivalent',
								rationale:
									'This deliberately broad entry must be rejected before mutation testing begins.',
								review: 'https://github.com/gabepsilva/Fit_/pull/5'
							}
						]
					},
					null,
					'\t'
				)}\n`
			)
	},
	{
		name: 'unused-file',
		gate: 'knip',
		description: 'A file nothing imports.',
		apply: (root) => write(root, 'src/lib/fixture.ts', 'export const unused = 1;\n')
	},
	{
		name: 'duplicated-block',
		gate: 'duplicates',
		description: 'The same block of logic in two files.',
		apply: async (root) => {
			await write(root, 'src/lib/fixture-a.ts', duplicatedBlock);
			await write(root, 'src/lib/fixture-b.ts', `${duplicatedBlock}export const tag = 'b';\n`);
		}
	},
	{
		name: 'invalid-workflow',
		gate: 'check:workflows',
		docker: true,
		description: 'A GitHub Actions workflow with an unknown runner and a bad expression.',
		apply: (root) =>
			write(
				root,
				'.github/workflows/fixture.yml',
				'name: Fixture\non: push\njobs:\n  broken:\n    runs-on: ubuntu-00.00\n    steps:\n      - run: echo "${{ github.no_such_context }}"\n'
			)
	},
	{
		name: 'missing-ci-job',
		gate: 'check:ci-contract',
		failureIncludes: 'CI workflow does not invoke declared jobs: mutation-security',
		description: 'A declared CI job omitted from the hosted workflow.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace('            job: mutation-security\n', '')
			)
	},
	{
		// The queue's whole point is that the gates run on `main` plus the queued
		// pull requests together, and that only happens if this workflow answers
		// `merge_group`. Delete the trigger and nothing goes red -- the required
		// check is simply never reported, and every merge blocks. That silence is
		// what this fixture buys a failure for.
		name: 'ci-without-merge-queue-trigger',
		gate: 'check:ci-contract',
		failureIncludes: 'no `merge_group:` trigger',
		description: "The CI workflow no longer answers the merge queue's combined branch.",
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) => content.replace('  merge_group:\n', ''))
	},
	{
		// A composite action is read from the workspace, so a job that calls one
		// without checking out first fails on "Can't find action" -- naming the
		// action, not the missing checkout. Three comments and QUALITY.md say this
		// check proves checkout stays in every job; this is the assertion that
		// makes that true.
		name: 'ci-job-without-checkout',
		gate: 'check:ci-contract',
		failureIncludes: 'CI jobs do not check the repository out',
		description:
			'A CI job that calls a local composite action without checking the repository out.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace(
					'      - name: Check out repository\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n\n',
					''
				)
			)
	},
	{
		// #167 moved the five pasted setup steps into one composite action, and
		// that is the shape that can hollow this check out: a job with no
		// toolchain in it reads exactly like a job with one, unless something
		// asks. This is the half that asks the job.
		name: 'ci-job-without-setup',
		gate: 'check:ci-contract',
		failureIncludes: 'CI jobs run Bun without the shared toolchain setup: static',
		description: 'A CI job that runs Bun with its shared toolchain setup removed.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace(
					'      - name: Set up the toolchain\n        uses: ./.github/actions/setup\n\n',
					''
				)
			)
	},
	{
		// The half that asks the action. Every job could still call it while it
		// had quietly stopped installing anything, and each job would then fail
		// on its own missing dependencies instead of naming what broke.
		name: 'gutted-setup-action',
		gate: 'check:ci-contract',
		failureIncludes: 'no longer installs from the lockfile',
		description: 'The shared toolchain action no longer installs the locked dependencies.',
		apply: (root) =>
			edit(root, '.github/actions/setup/action.yml', (content) =>
				content.replace('      run: bun install --frozen-lockfile\n', '')
			)
	},
	{
		// `if: always()` has to stay at the call site. A condition inside the
		// composite cannot resurrect a step the job already skipped, so a gate
		// that failed would upload no evidence at all and the run would look
		// tidier for it.
		name: 'unconditional-report-upload',
		gate: 'check:ci-contract',
		failureIncludes: 'Upload static reports',
		description: 'A report upload that no longer runs once the gate it documents fails.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace(
					'        if: always()\n        uses: ./.github/actions/upload-report\n',
					'        uses: ./.github/actions/upload-report\n'
				)
			)
	},
	{
		// The full mutation lane is no longer a merge gate, so nothing in ci.yml
		// would notice it disappearing. This is what stands in its place: delete
		// the cron and the lane stops running entirely, which is the exact way
		// moving a lane off pull requests goes wrong.
		name: 'unscheduled-audit-lane',
		gate: 'check:schedules',
		failureIncludes: 'Tier "audit" runs on no schedule',
		description: 'The scheduled full-tree mutation audit left with no schedule to run on.',
		apply: (root) =>
			edit(root, '.github/workflows/mutation-audit.yml', (content) =>
				content.replace("    - cron: '41 4 * * *'\n", '')
			)
	},
	{
		// The trap a non-blocking lane walks into: every step swallows its exit,
		// so `if: failure()` never fires, the run is green, and the debt is
		// invisible. Exactly the shape this workflow had to avoid.
		name: 'unreachable-schedule-report',
		gate: 'check:schedules',
		failureIncludes: 'which can never fire',
		description: 'A non-blocking scheduled lane reporting on a job failure that cannot happen.',
		apply: (root) =>
			edit(root, '.github/workflows/mutation-audit.yml', (content) =>
				content.replace(
					"- name: Update the mutation debt ledger issue\n        if: '!cancelled()'",
					'- name: Update the mutation debt ledger issue\n        if: failure()'
				)
			)
	},
	{
		// A scheduled lane nobody hears about is the other half of the same
		// failure: green Actions tab, silent mutation debt.
		name: 'silent-scheduled-lane',
		gate: 'check:schedules',
		failureIncludes: 'cannot surface a failure',
		description: 'A scheduled tier that can no longer open an issue when it goes red.',
		apply: (root) =>
			edit(root, '.github/workflows/mutation-audit.yml', (content) =>
				// Every job in the file, not just one: `surfacesFailure` reads the
				// whole workflow source, so as long as any job still declares
				// `issues: write` the file as a whole can still surface a failure.
				content.replaceAll('      issues: write\n', '')
			)
	},
	{
		name: 'unprotected-ci-job',
		gate: 'check:ci-contract',
		failureIncludes: 'all-green.needs does not protect hosted gate jobs: mutation',
		description: 'A hosted mutation job omitted from the protected merge-gate aggregator.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace('        mutation,\n', '')
			)
	},
	{
		// The end-to-end suite is sharded one job per browser project. Dropping a
		// project from the matrix is how that sharding goes wrong: the suite still
		// passes, on fewer browsers, and nothing else in the tree would notice.
		name: 'dropped-e2e-project',
		gate: 'check:ci-contract',
		failureIncludes: 'CI workflow does not run every end-to-end project: firefox',
		description: 'A declared browser project dropped from the hosted end-to-end matrix.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace('          - project: firefox\n            browser: firefox\n', '')
			)
	},
	{
		// The same failure mode for the self-test's own shards: a group that stops
		// running takes its fixtures with it, and the gates they prove go untested
		// while the job still reports green.
		name: 'unrun-self-test-group',
		gate: 'check:ci-contract',
		failureIncludes: 'CI workflow does not run every gate self-test group: mutation',
		description: 'A gate self-test group dropped from the hosted workflow.',
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace('      SELF_TEST_GROUP: mutation\n', '')
			)
	},
	{
		// self-test-mutation is allowed to report `skipped`, but only when
		// self-test-scope says the group was not needed -- otherwise a scope
		// job that itself failed (or any other cause of a skip) would sail
		// through all-green disguised as "nothing to run here". This fixture
		// removes the step that tells those apart and proves the general
		// `success`-only loop below it is not enough on its own.
		name: 'ungated-conditional-self-test-skip',
		gate: 'check:ci-contract',
		failureIncludes:
			"all-green does not gate the following conditional self-test jobs' skipped result on their own scope output: self-test-mutation",
		description: "all-green no longer checks self-test-mutation's skip against its scope output.",
		apply: (root) =>
			edit(root, '.github/workflows/ci.yml', (content) =>
				content.replace(
					`      - name: Require self-test-mutation to have succeeded, or been correctly skipped
        env:
          RESULT: \${{ needs.self-test-mutation.result }}
          MUTATION_NEEDED: \${{ needs.self-test-scope.outputs.mutation-needed }}
        run: |
          echo "self-test-mutation: $RESULT (self-test-scope mutation-needed=$MUTATION_NEEDED)"
          if [[ "$RESULT" == "success" ]]; then
            exit 0
          fi
          if [[ "$RESULT" == "skipped" && "$MUTATION_NEEDED" == "false" ]]; then
            echo "Skipped correctly: self-test-scope found nothing that could break the mutation self-test group."
            exit 0
          fi
          echo "::error::self-test-mutation is $RESULT but self-test-scope reports mutation-needed=$MUTATION_NEEDED; it must succeed, or be skipped only when not needed."
          exit 1

`,
					''
				)
			)
	},
	{
		name: 'oversized-bundle',
		gate: 'check:bundle',
		prepare: ['build'],
		description: 'A client module far larger than the byte budget.',
		apply: async (root) => {
			const payload = 'fit-bundle-budget-fixture-payload-'.repeat(8000);
			await write(root, 'src/lib/fixture.ts', `export const payload = '${payload}';\n`);
			// A route of its own, not an edit to an existing page: the payload
			// still counts against the budget, and the fixture cannot be broken
			// by whatever a real page happens to contain.
			await write(
				root,
				'src/routes/fixture/+page.svelte',
				`<script lang="ts">\n\timport { payload } from '$lib/fixture';\n</script>\n\n<p>{payload.length}</p>\n`
			);
		}
	},
	{
		name: 'uncovered-file',
		gate: 'test:coverage',
		browser: true,
		description: 'An untested module, which per-file coverage thresholds must catch.',
		apply: (root) =>
			write(
				root,
				'src/lib/fixture.ts',
				'export function classify(value: number): string {\n\tif (value > 10) return "high";\n\tif (value > 5) return "medium";\n\treturn "low";\n}\n'
			)
	},
	{
		name: 'legacy-full-survivors',
		gate: 'test:mutation:fixture:full',
		failureIncludes: 'full-tree mutation score 70.00 is below 80',
		description: 'A tiny synthetic full-tree report below the preserved 80 percent score.',
		apply: async (root) => {
			const source = 'export function add(a: number, b: number): number {\n\treturn a + b;\n}\n';
			await write(root, 'src/lib/fixture.ts', source);
			await write(
				root,
				'reports/mutation/fixture/scope.json',
				`${JSON.stringify(
					{
						version: 2,
						lane: 'full',
						project: 'all',
						base: null,
						fallback: null,
						files: [{ path: 'src/lib/fixture.ts', changeStatus: null, changedLines: [] }]
					},
					null,
					'\t'
				)}\n`
			);
			const mutants = Array.from({ length: 10 }, (_, index) => ({
				id: String(index),
				status: index < 7 ? 'Killed' : 'Survived',
				mutatorName: 'ArithmeticOperator',
				replacement: '-',
				location: { start: { line: 2, column: 8 }, end: { line: 2, column: 13 } }
			}));
			await write(
				root,
				'reports/mutation/fixture/mutation.json',
				`${JSON.stringify({ files: { 'src/lib/fixture.ts': { source, mutants } } }, null, '\t')}\n`
			);
		}
	},
	{
		name: 'security-surviving-mutant',
		gate: 'test:mutation:security',
		exclusive: true,
		// The debt half of the pair proved by `crashed-mutation-run` below: real
		// surviving mutants are a verdict, and a verdict exits 1.
		expectedExitCode: 1,
		failureIncludes: 'changed-line score',
		description: 'A shallow server test leaves a security-boundary mutant alive.',
		apply: async (root) => {
			await write(
				root,
				'src/lib/server/fixture.ts',
				'export function authorize(owner: string, actor: string): boolean {\n\treturn owner === actor;\n}\n'
			);
			await write(
				root,
				'src/lib/server/fixture.spec.ts',
				"import { expect, it } from 'vitest';\nimport { authorize } from './fixture';\n\nit('returns an authorization decision', () => {\n\texpect(typeof authorize('owner', 'stranger')).toBe('boolean');\n});\n"
			);
		}
	},
	{
		name: 'crashed-mutation-run',
		gate: 'test:mutation:security',
		exclusive: true,
		expectedExitCode: CRASH_EXIT_CODE,
		failureIncludes: 'mutation lane CRASHED: it produced no verdict',
		description:
			'A mutation runner that dies before writing a report must report a crash, not debt.',
		// The observed incident: Stryker's dry run died resolving the vitest
		// projects, so the lane left only `scope.json` behind and exited 1 —
		// indistinguishable from surviving mutants. Throwing out of the config
		// reproduces that ending exactly, and the lane has to name it a crash.
		apply: (root) =>
			edit(
				root,
				'vite.config.ts',
				(content) => `${content}\nthrow new Error('Failed to initialize projects');\n`
			)
	},
	{
		name: 'changed-node-surviving-mutant',
		gate: 'test:mutation:changed:node',
		exclusive: true,
		stage: false,
		failureIncludes: 'changed-line score',
		description: 'A surviving mutant in an untracked Node module must fail change-scoped mutation.',
		baselinePaths: ['src/lib/domain/fixture.spec.ts'],
		apply: async (root) => {
			await write(
				root,
				'src/lib/domain/fixture.ts',
				'export function classify(value: number): string {\n\treturn value > 0 ? "positive" : "other";\n}\n'
			);
			await write(
				root,
				'src/lib/domain/fixture.spec.ts',
				"import { expect, it } from 'vitest';\nimport { classify } from './fixture';\n\nit('exports the classifier', () => {\n\texpect(typeof classify).toBe('function');\n});\n"
			);
		}
	},
	{
		name: 'changed-client-surviving-mutant',
		gate: 'test:mutation:changed:client',
		browser: true,
		exclusive: true,
		failureIncludes: 'changed-line score',
		description: 'A surviving mutant in a changed client module must fail change-scoped mutation.',
		// The baseline is what a developer adding this module would have
		// committed; only `fixture.ts`, the module whose mutant survives, is
		// left outside it.
		baselinePaths: ['src/lib/ui/fixture.svelte.test.ts', 'quality/dom-free-client-specs.mjs'],
		apply: async (root) => {
			await write(
				root,
				'src/lib/ui/fixture.ts',
				'export function classify(value: number): string {\n\treturn value > 0 ? "positive" : "other";\n}\n'
			);
			await write(
				root,
				'src/lib/ui/fixture.svelte.test.ts',
				"import { expect, it } from 'vitest';\nimport { classify } from './fixture';\n\nit('exports the classifier', () => {\n\texpect(typeof classify).toBe('function');\n});\n"
			);
			// Mutation runs skip the browser project, so an unregistered spec
			// would leave this module measured by nothing and Stryker would
			// exit on "No tests were found" rather than the surviving mutant.
			await edit(root, 'quality/dom-free-client-specs.mjs', (content) =>
				content.replace(
					"\t'src/lib/ui/download.svelte.spec.ts'\n",
					"\t'src/lib/ui/download.svelte.spec.ts',\n\t'src/lib/ui/fixture.svelte.test.ts'\n"
				)
			);
		}
	},
	{
		name: 'broken-component',
		gate: 'build',
		description: 'A Svelte component that cannot compile.',
		apply: (root) =>
			write(
				root,
				'src/routes/fixture/+page.svelte',
				'<script lang="ts">\n\tconst value = ;\n</script>\n'
			)
	},
	{
		name: 'committed-secret',
		gate: 'security:gitleaks',
		docker: true,
		description: 'A credential in the working tree.',
		apply: (root) =>
			// Assembled at run time so this repository never contains the pattern.
			write(
				root,
				'src/lib/fixture.ts',
				`export const key = '${['AKI', 'AQ3', 'T7X', '2LM', 'NBV', 'CZX', 'R4T'].join('')}';\n`
			)
	},
	{
		name: 'dynamic-code-execution',
		gate: 'security:semgrep',
		docker: true,
		description: 'Dynamic code execution, which the project Semgrep rules reject.',
		apply: (root) =>
			write(
				root,
				'src/lib/fixture.ts',
				'export function run(source: string): unknown {\n\treturn eval(source);\n}\n'
			)
	},
	{
		name: 'missing-heading',
		gate: 'test:e2e',
		browser: true,
		description: 'A page whose heading the end-to-end flow asserts on.',
		apply: (root) => write(root, 'src/routes/progress/+page.svelte', '<p>no heading here</p>\n')
	}
];

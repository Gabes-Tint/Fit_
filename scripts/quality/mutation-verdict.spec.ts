import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MutationPolicy, MutationReviewLedger, MutationScope } from './mutation-types';
import { parseMutationPolicy } from './mutation-types';
import {
	evaluateMutationReport,
	mutantFingerprint,
	sourceWindowHash,
	sourceWindowStatus,
	verifyMutationFiles
} from './mutation-verdict';

const roots: string[] = [];
const policy: MutationPolicy = {
	version: 1,
	full: {
		aggregateScore: 80
	},
	security: {
		aggregateKilled: 90,
		perFileKilled: 80,
		changedLinesKilled: 100,
		maxTimeouts: 0,
		maxNoCoverage: 0,
		maxErrors: 0
	},
	changed: {
		aggregateKilled: 80,
		perFileKilled: 80,
		changedLinesKilled: 100,
		maxTimeouts: 0,
		maxNoCoverage: 0,
		maxErrors: 0
	}
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; scope: MutationScope }> {
	const root = await mkdtemp(path.join(tmpdir(), 'fit-mutation-verdict-'));
	roots.push(root);
	await mkdir(path.join(root, 'src'), { recursive: true });
	await writeFile(
		path.join(root, 'src/a.ts'),
		'export function choose(value: boolean) { return value ? 1 : 2; }\n'
	);
	return {
		root,
		scope: {
			version: 2,
			lane: 'security',
			project: 'server',
			base: null,
			fallback: null,
			files: [{ path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 1, end: 1 }] }]
		}
	};
}

function mutant(id: string, status: string, line = 1) {
	return {
		id,
		status,
		mutatorName: 'ConditionalExpression',
		replacement: 'false',
		location: { start: { line, column: 0 }, end: { line, column: 1 } }
	};
}

describe('mutation verdict', () => {
	it('rejects a mutation policy with a missing limit instead of disabling its comparison', () => {
		expect(() =>
			parseMutationPolicy({
				...policy,
				changed: {
					aggregateKilled: 80,
					changedLinesKilled: 100,
					maxTimeouts: 0,
					maxNoCoverage: 0,
					maxErrors: 0
				}
			})
		).toThrow('mutation policy.changed must have exactly keys');
	});
	it('counts only explicit kills as positive', async () => {
		const { root, scope } = await fixture();
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: 'export const a = true;',
						mutants: [
							mutant('1', 'Killed'),
							mutant('2', 'Timeout'),
							mutant('3', 'NoCoverage'),
							mutant('4', 'CompileError')
						]
					}
				}
			}
		});
		expect(verdict.killedScore).toBe(25);
		expect(verdict.failures).toEqual(
			expect.arrayContaining([
				expect.stringContaining('timeouts 1'),
				expect.stringContaining('uncovered mutants 1'),
				expect.stringContaining('errored mutants 1')
			])
		);
		expect(verdict.ok).toBe(false);
	});

	it('rejects a changed-line survivor even when the file score passes', async () => {
		const { root, scope } = await fixture();
		const mutants = Array.from({ length: 10 }, (_, index) =>
			mutant(String(index), index === 0 ? 'Survived' : 'Killed', index === 0 ? 1 : 2)
		);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: { files: { 'src/a.ts': { source: 'export const a = true;', mutants } } }
		});
		expect(verdict.killedScore).toBe(90);
		expect(verdict.failures).toContain('src/a.ts observable changed-line score 0.00 is below 100');
	});

	it('enforces per-file thresholds instead of allowing aggregation to hide a weak file', async () => {
		const { root, scope } = await fixture();
		await writeFile(path.join(root, 'src/b.ts'), 'export const answer = 42;\n');
		scope.files.push({ path: 'src/b.ts', changeStatus: null, changedLines: [] });
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: 'export const a = true;',
						mutants: Array.from({ length: 20 }, (_, index) => mutant(`a${index}`, 'Killed'))
					},
					'src/b.ts': {
						source: 'export const answer = 42;',
						mutants: [mutant('b1', 'Survived'), mutant('b2', 'Killed')]
					}
				}
			}
		});
		expect(verdict.killedScore).toBeGreaterThan(90);
		expect(verdict.failures).toContain('src/b.ts killed-only score 50.00 is below 80');
	});

	it('uses the legacy aggregate only for unchanged files in a broad fallback', async () => {
		const { root, scope } = await fixture();
		const changedSource = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const backgroundSource = 'export const answer = 42;\n';
		await writeFile(path.join(root, 'src/b.ts'), backgroundSource);
		scope.lane = 'changed-node';
		scope.fallback = 'mutation-infrastructure-changed';
		scope.files.push({ path: 'src/b.ts', changeStatus: null, changedLines: [] });
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: changedSource,
						mutants: Array.from({ length: 10 }, (_, index) => mutant(`a${index}`, 'Killed'))
					},
					'src/b.ts': {
						source: backgroundSource,
						mutants: [
							...Array.from({ length: 7 }, (_, index) => mutant(`b${index}`, 'Killed')),
							mutant('b-timeout', 'Timeout'),
							mutant('b-survivor', 'Survived'),
							mutant('b-uncovered', 'NoCoverage')
						]
					}
				}
			}
		});
		expect(verdict.ok).toBe(true);
		expect(verdict.verdictMode).toBe('strict-changed-with-legacy-background');
		expect(verdict.strictFiles).toBe(1);
		expect(verdict.strictKilledScore).toBe(100);
		expect(verdict.backgroundMutationScore).toBe(80);
		expect(verdict.timeout).toBe(1);
		expect(verdict.noCoverage).toBe(1);
	});

	it('rejects a changed production survivor even when fallback background passes', async () => {
		const { root, scope } = await fixture();
		const changedSource = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const backgroundSource = 'export const answer = 42;\n';
		await writeFile(path.join(root, 'src/b.ts'), backgroundSource);
		scope.lane = 'changed-node';
		scope.fallback = 'test-input-changed';
		scope.files.push({ path: 'src/b.ts', changeStatus: null, changedLines: [] });
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: changedSource,
						mutants: [
							mutant('changed-survivor', 'Survived'),
							...Array.from({ length: 9 }, (_, index) => mutant(`a${index}`, 'Killed'))
						]
					},
					'src/b.ts': {
						source: backgroundSource,
						mutants: [
							...Array.from({ length: 8 }, (_, index) => mutant(`b${index}`, 'Killed')),
							mutant('b1', 'Survived'),
							mutant('b2', 'Survived')
						]
					}
				}
			}
		});
		expect(verdict.backgroundMutationScore).toBe(80);
		expect(verdict.failures).toContain('src/a.ts observable changed-line score 90.00 is below 100');
		expect(verdict.ok).toBe(false);
	});

	it('keeps a deletion-only changed production file strict during broad fallback', async () => {
		const { root, scope } = await fixture();
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		scope.lane = 'changed-node';
		scope.fallback = 'test-input-changed';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed')),
							mutant('uncovered', 'NoCoverage')
						]
					}
				}
			}
		});
		expect(verdict.strictFiles).toBe(1);
		expect(verdict.files[0]?.observableChangedKilledScore).toBeNull();
		expect(verdict.failures).toContain('strict changed uncovered mutants 1 exceed 0');
		expect(verdict.ok).toBe(false);
	});

	it('lifts strict liability from a change that only rewrites a comment', async () => {
		const { root, scope } = await fixture();
		const source = [
			'// A comment that a sweep rewrote, and nothing else.',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 1, end: 1 }] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							...Array.from({ length: 4 }, (_, index) => mutant(String(index), 'Killed', 2)),
							mutant('survivor', 'Survived', 2),
							mutant('uncovered', 'NoCoverage', 2)
						]
					}
				}
			}
		});
		expect(verdict.inertFiles).toBe(1);
		expect(verdict.files[0]?.inertChange).toBe(true);
		expect(verdict.strictFiles).toBe(0);
		expect(verdict.failures).toEqual([]);
		expect(verdict.ok).toBe(true);
	});

	it('lifts strict liability from a rewritten JSDoc block, which is a node and not trivia', async () => {
		const { root, scope } = await fixture();
		const source = [
			'/**',
			' * A doc block that a sweep rewrote.',
			' */',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 1, end: 3 }] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [mutant('survivor', 'Survived', 4), mutant('uncovered', 'NoCoverage', 4)]
					}
				}
			}
		});
		expect(verdict.files[0]?.inertChange).toBe(true);
		expect(verdict.strictFiles).toBe(0);
		expect(verdict.ok).toBe(true);
	});

	it('keeps a rename strict even though Stryker produces no mutant for it', async () => {
		const { root, scope } = await fixture();
		const source = [
			'import { helper } from "./helper";',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			'export const answer = helper();',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 3, end: 3 }] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							...Array.from({ length: 3 }, (_, index) => mutant(String(index), 'Killed', 2)),
							mutant('survivor', 'Survived', 2),
							mutant('second-survivor', 'Survived', 2)
						]
					}
				}
			}
		});
		expect(verdict.files[0]?.inertChange).toBe(false);
		expect(verdict.strictFiles).toBe(1);
		expect(verdict.failures).toContain('src/a.ts killed-only score 60.00 is below 80');
	});

	it('excuses an import-only change but not the statement below it', async () => {
		const { root, scope } = await fixture();
		const source = [
			'import { helper } from "./helper";',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		const evaluate = async (changedLines: { start: number; end: number }[]) => {
			scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines };
			return evaluateMutationReport({
				projectRoot: root,
				lane: 'changed-node',
				scope,
				policy,
				report: {
					files: {
						'src/a.ts': {
							source,
							mutants: [mutant('survivor', 'Survived', 2)]
						}
					}
				}
			});
		};
		expect((await evaluate([{ start: 1, end: 1 }])).files[0]?.inertChange).toBe(true);
		expect((await evaluate([{ start: 2, end: 2 }])).files[0]?.inertChange).toBe(false);
	});

	it('is not defeated by an enclosing block mutant that merely spans the comment', async () => {
		const { root, scope } = await fixture();
		const source = [
			'export function choose(value: boolean) {',
			'\t// A comment inside the body, which the block mutant spans.',
			'\treturn value ? 1 : 2;',
			'}',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 2, end: 2 }] };
		const block = {
			...mutant('block', 'Killed', 1),
			mutatorName: 'BlockStatement',
			location: { start: { line: 1, column: 40 }, end: { line: 4, column: 1 } }
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': { source, mutants: [block, mutant('uncovered', 'NoCoverage', 3)] }
				}
			}
		});
		expect(verdict.files[0]?.inertChange).toBe(true);
		expect(verdict.strictFiles).toBe(0);
		expect(verdict.ok).toBe(true);
	});

	it('keeps a file strict when Stryker mutated a line the syntax read called inert', async () => {
		const { root, scope } = await fixture();
		const source = [
			'// A comment, which carries no token of its own.',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.lane = 'changed-node';
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 1, end: 1 }] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						// Stryker disagreeing with the syntax read has to fail closed
						// rather than excuse the file.
						mutants: [mutant('survivor', 'Survived', 1)]
					}
				}
			}
		});
		expect(verdict.files[0]?.inertChange).toBe(false);
		expect(verdict.strictFiles).toBe(1);
	});

	it('keeps a security file strict even when its change reaches no mutable code', async () => {
		const { root, scope } = await fixture();
		const source = [
			'// Only a comment moved here.',
			'export function choose(value: boolean) { return value ? 1 : 2; }',
			''
		].join('\n');
		await writeFile(path.join(root, 'src/a.ts'), source);
		scope.files[0] = { path: 'src/a.ts', changeStatus: 'M', changedLines: [{ start: 1, end: 1 }] };
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [mutant('uncovered', 'NoCoverage', 2)]
					}
				}
			}
		});
		expect(verdict.inertFiles).toBe(0);
		expect(verdict.strictFiles).toBe(1);
		expect(verdict.failures).toContain('strict changed uncovered mutants 1 exceed 0');
	});

	it('fails closed when a scope omits explicit changed-production identity', async () => {
		const { root, scope } = await fixture();
		delete (scope.files[0] as Partial<(typeof scope.files)[number]>).changeStatus;
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: 'export function choose(value: boolean) { return value ? 1 : 2; }\n',
						mutants: [mutant('1', 'Killed')]
					}
				}
			}
		});
		expect(verdict.failures).toContain('mutation scope has invalid change status: src/a.ts');
		expect(verdict.ok).toBe(false);
	});

	it('keeps every file strict in a normal changed scope', async () => {
		const { root, scope } = await fixture();
		const backgroundSource = 'export const answer = 42;\n';
		await writeFile(path.join(root, 'src/b.ts'), backgroundSource);
		scope.lane = 'changed-node';
		scope.files.push({ path: 'src/b.ts', changeStatus: null, changedLines: [] });
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source: 'export function choose(value: boolean) { return value ? 1 : 2; }\n',
						mutants: [mutant('a', 'Killed')]
					},
					'src/b.ts': {
						source: backgroundSource,
						mutants: [mutant('b1', 'Killed'), mutant('b2', 'Survived')]
					}
				}
			}
		});
		expect(verdict.strictFiles).toBe(2);
		expect(verdict.failures).toContain('src/b.ts killed-only score 50.00 is below 80');
	});

	it('rejects reports outside the discovered scope and omitted executable files', async () => {
		const { root, scope } = await fixture();
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/other.ts': { source: 'export const other = true;', mutants: [mutant('1', 'Killed')] }
				}
			}
		});
		expect(verdict.failures).toEqual(
			expect.arrayContaining([
				expect.stringContaining('outside scope'),
				expect.stringContaining('omitted executable scoped files')
			])
		);
	});

	it('rejects an omitted class property initializer', async () => {
		const { root, scope } = await fixture();
		await writeFile(path.join(root, 'src/a.ts'), 'export class Settings { enabled = true; }\n');
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: { files: {} }
		});
		expect(verdict.failures).toContain('report omitted executable scoped files: src/a.ts');
	});

	it.each([
		['a default-exported literal', 'export default true;\n'],
		['an enum member initializer', "export enum Mode { Ready = 'ready' }\n"],
		['a side-effect call', 'declare function boot(enabled: boolean): void;\nboot(true);\n'],
		['a constructed value', "new Worker('worker.js');\n"],
		['a top-level throw', "throw new Error('stopped');\n"],
		['a prefix update', 'let count = 0;\n++count;\n'],
		['a postfix update', 'let count = 0;\ncount++;\n']
	])('does not let another file mask omitted executable code in %s', async (_, omittedSource) => {
		const { root, scope } = await fixture();
		await writeFile(path.join(root, 'src/b.ts'), omittedSource);
		scope.files.push({ path: 'src/b.ts', changeStatus: null, changedLines: [] });
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: Array.from({ length: 10 }, (_, index) => mutant(String(index), 'Killed'))
					}
				}
			}
		});
		expect(verdict.failures).toContain('report omitted executable scoped files: src/b.ts');
	});

	it('allows an empty changed lane but never an empty security lane', async () => {
		const { root, scope } = await fixture();
		scope.files = [];
		const security = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			report: { files: {} }
		});
		scope.lane = 'changed-node';
		const changed = await evaluateMutationReport({
			projectRoot: root,
			lane: 'changed-node',
			scope,
			policy,
			report: { files: {} }
		});
		expect(security.ok).toBe(false);
		expect(changed.ok).toBe(true);
	});

	it('rejects a report that predates the current run', async () => {
		const { root, scope } = await fixture();
		const scopePath = path.join(root, 'scope.json');
		const reportPath = path.join(root, 'mutation.json');
		const policyPath = path.join(root, 'policy.json');
		const ledgerPath = path.join(root, 'ledger.json');
		await Promise.all([
			writeFile(scopePath, JSON.stringify(scope)),
			writeFile(reportPath, JSON.stringify({ files: {} })),
			writeFile(policyPath, JSON.stringify(policy)),
			writeFile(ledgerPath, JSON.stringify({ version: 1, entries: [] }))
		]);
		await expect(
			verifyMutationFiles({
				projectRoot: root,
				lane: 'security',
				scopePath,
				reportPath,
				policyPath,
				ledgerPath,
				verdictPath: path.join(root, 'verdict.json'),
				// Comfortably past the margin the check now allows for coarse
				// filesystem timestamps. It used to be a second, which is exactly
				// that margin, so the case would have sat on the boundary it is
				// meant to be well clear of.
				startedAt: Date.now() + 60_000
			})
		).rejects.toThrow('Mutation report is stale.');
	});

	it('accepts a report written moments after the run began', async () => {
		// The regression this guards. A changed lane with an empty scope writes
		// its report microseconds after `startedAt`, and a filesystem that stamps
		// from the coarse clock hands back an mtime just before it -- which read
		// as a stale report and failed every pull request that mutated nothing.
		const { root, scope } = await fixture();
		const scopePath = path.join(root, 'scope.json');
		const reportPath = path.join(root, 'mutation.json');
		const policyPath = path.join(root, 'policy.json');
		const ledgerPath = path.join(root, 'ledger.json');
		const startedAt = Date.now();
		await Promise.all([
			writeFile(scopePath, JSON.stringify(scope)),
			writeFile(reportPath, JSON.stringify({ files: {} })),
			writeFile(policyPath, JSON.stringify(policy)),
			writeFile(ledgerPath, JSON.stringify({ version: 1, entries: [] }))
		]);
		const verdict = await verifyMutationFiles({
			projectRoot: root,
			lane: 'security',
			scopePath,
			reportPath,
			policyPath,
			ledgerPath,
			verdictPath: path.join(root, 'verdict.json'),
			// A tick behind the write, the way a coarse clock reports it.
			startedAt: startedAt + 5
		});
		expect(verdict.lane).toBe('security');
	});

	it('accepts only an exact, reviewed survivor fingerprint on a changed line', async () => {
		const { root, scope } = await fixture();
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const survivor = mutant('reviewed', 'Survived');
		const sourceHash = createHash('sha256').update(source).digest('hex');
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash,
			classification: 'equivalent' as const,
			rationale:
				'The replacement returns the same externally observable value for every valid input.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		const ledger: MutationReviewLedger = {
			version: 1,
			entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }]
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							survivor,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed'))
						]
					}
				}
			}
		});
		expect(verdict.ok).toBe(true);
		expect(verdict.reviewedSurvivors).toBe(1);
		expect(verdict.files[0]?.reviewedChangedSurvivors).toBe(1);
		expect(verdict.files[0]?.observableChangedKilledScore).toBe(100);
	});

	it('invalidates a review when the scoped source no longer matches its report', async () => {
		const { root, scope } = await fixture();
		const oldSource = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const survivor = mutant('reviewed', 'Survived');
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash: createHash('sha256').update(oldSource).digest('hex'),
			classification: 'equivalent' as const,
			rationale:
				'The old source made this replacement observationally identical for every valid input.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		await writeFile(
			path.join(root, 'src/a.ts'),
			'export function choose(value: boolean) { return value ? 3 : 4; }\n'
		);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: { files: { 'src/a.ts': { source: oldSource, mutants: [survivor] } } }
		});
		expect(verdict.failures).toEqual(
			expect.arrayContaining([
				expect.stringContaining('report source does not match scoped file'),
				expect.stringContaining('stale or no longer survives')
			])
		);
	});

	it('keeps an accepted equivalence when an unrelated line elsewhere in the file changes', async () => {
		const { root, scope } = await fixture();
		const originalSource =
			'export function choose(value: boolean) {\n' +
			'\treturn value ? 1 : 2;\n' +
			'}\n' +
			'\n' +
			'export const unrelated = 1;\n';
		const survivor = mutant('reviewed', 'Survived', 2);
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash: sourceWindowHash(originalSource, survivor.location),
			classification: 'equivalent' as const,
			rationale:
				'The replacement returns the same externally observable value for every valid input.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		// Edited far from the mutated line -- an unrelated constant, not the
		// guarded expression the acceptance reasons about.
		const updatedSource = originalSource.replace('unrelated = 1', 'unrelated = 2');
		await writeFile(path.join(root, 'src/a.ts'), updatedSource);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: {
				files: {
					'src/a.ts': {
						source: updatedSource,
						mutants: [
							survivor,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed'))
						]
					}
				}
			}
		});
		expect(verdict.reviewedSurvivors).toBe(1);
		expect(verdict.failures).not.toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('retires an accepted equivalence when the edit lands on the mutated line', async () => {
		const { root, scope } = await fixture();
		const originalSource =
			'export function choose(value: boolean) {\n' +
			'\treturn value ? 1 : 2;\n' +
			'}\n' +
			'\n' +
			'export const unrelated = 1;\n';
		const survivor = mutant('reviewed', 'Survived', 2);
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash: sourceWindowHash(originalSource, survivor.location),
			classification: 'equivalent' as const,
			rationale:
				'The old reasoning was about this exact guarded expression, which the edit below changes.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		// Edited on the mutated line itself.
		const updatedSource = originalSource.replace('value ? 1 : 2', 'value ? 3 : 4');
		await writeFile(path.join(root, 'src/a.ts'), updatedSource);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: { files: { 'src/a.ts': { source: updatedSource, mutants: [survivor] } } }
		});
		expect(verdict.reviewedSurvivors).toBe(0);
		expect(verdict.failures).toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('matches a declared Timeout entry against a mutant Stryker can only ever time out', async () => {
		const { root, scope } = await fixture();
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const looping = mutant('reviewed', 'Timeout');
		const sourceHash = createHash('sha256').update(source).digest('hex');
		const entry = {
			file: 'src/a.ts',
			mutatorName: looping.mutatorName,
			replacement: looping.replacement,
			location: looping.location,
			sourceHash,
			classification: 'equivalent' as const,
			rationale:
				'This mutation turns a countdown into a count-up, so the loop never terminates and Stryker can only ever time it out.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5',
			status: 'Timeout' as const
		};
		const ledger: MutationReviewLedger = {
			version: 1,
			entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }]
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							looping,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed'))
						]
					}
				}
			}
		});
		expect(verdict.reviewedSurvivors).toBe(1);
		expect(verdict.failures).not.toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('rejects a declared Timeout entry whose mutant actually survives', async () => {
		const { root, scope } = await fixture();
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const survivor = mutant('reviewed', 'Survived');
		const sourceHash = createHash('sha256').update(source).digest('hex');
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash,
			classification: 'equivalent' as const,
			rationale:
				'A deliberately mis-declared status: this mutant actually survives, not times out, and the check must reject it.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5',
			status: 'Timeout' as const
		};
		const ledger: MutationReviewLedger = {
			version: 1,
			entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }]
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							survivor,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed'))
						]
					}
				}
			}
		});
		expect(verdict.reviewedSurvivors).toBe(0);
		expect(verdict.failures).toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('rejects a default (Survived) entry whose mutant actually times out', async () => {
		const { root, scope } = await fixture();
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const looping = mutant('reviewed', 'Timeout');
		const sourceHash = createHash('sha256').update(source).digest('hex');
		const entry = {
			file: 'src/a.ts',
			mutatorName: looping.mutatorName,
			replacement: looping.replacement,
			location: looping.location,
			sourceHash,
			classification: 'equivalent' as const,
			rationale:
				'A default-status entry (no `status` field, so it excuses only Survived) pointed at a mutant that actually times out, which the check must reject rather than assume.'
		};
		const ledgerEntry = { ...entry, review: 'https://github.com/gabepsilva/Fit_/pull/5' };
		const ledger: MutationReviewLedger = {
			version: 1,
			entries: [{ ...ledgerEntry, fingerprint: mutantFingerprint(ledgerEntry) }]
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							looping,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed'))
						]
					}
				}
			}
		});
		expect(verdict.reviewedSurvivors).toBe(0);
		expect(verdict.failures).toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('fingerprints a mutant by its code, not its location', () => {
		// A line inserted above a mutant shifts every line number below it
		// without touching the mutant's own text -- the fingerprint must not
		// notice the shift, only a change to the code itself.
		const before = {
			file: 'src/a.ts',
			mutatorName: 'UpdateOperator',
			replacement: 'i++',
			location: { start: { line: 61, column: 0 }, end: { line: 61, column: 3 } },
			sourceHash: '0'.repeat(64)
		};
		const afterInsertionAbove = {
			file: 'src/a.ts',
			mutatorName: 'UpdateOperator',
			replacement: 'i++',
			location: { start: { line: 65, column: 0 }, end: { line: 65, column: 3 } },
			sourceHash: '0'.repeat(64)
		};
		expect(mutantFingerprint(before)).toBe(mutantFingerprint(afterInsertionAbove));

		const differentCode = { ...before, sourceHash: '1'.repeat(64) };
		expect(mutantFingerprint(before)).not.toBe(mutantFingerprint(differentCode));
	});

	it('keeps an accepted equivalence when a line is inserted above the mutant', async () => {
		const { root, scope } = await fixture();
		const originalSource =
			'export function choose(value: boolean) {\n' +
			'\treturn value ? 1 : 2;\n' +
			'}\n' +
			'\n' +
			'export const unrelated = 1;\n';
		const survivor = mutant('reviewed', 'Survived', 2);
		const entry = {
			file: 'src/a.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash: sourceWindowHash(originalSource, survivor.location),
			classification: 'equivalent' as const,
			rationale:
				'The replacement returns the same externally observable value for every valid input.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		// A comment inserted above the function shifts the mutant from line 2
		// to line 3, without changing a character of its own text.
		const updatedSource = '// a new comment\n' + originalSource;
		const shiftedSurvivor = mutant('reviewed', 'Survived', 3);
		await writeFile(path.join(root, 'src/a.ts'), updatedSource);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: {
				files: {
					'src/a.ts': {
						source: updatedSource,
						mutants: [
							shiftedSurvivor,
							...Array.from({ length: 9 }, (_, index) => mutant(String(index), 'Killed', 3))
						]
					}
				}
			}
		});
		expect(verdict.reviewedSurvivors).toBe(1);
		expect(verdict.failures).not.toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('excuses every occurrence of an identical mutated window from one ledger entry', async () => {
		const { root, scope } = await fixture();
		// The same three lines, twice in a row, so the two survivors' windows
		// -- each the mutated line plus one line of context on either side --
		// hash identically. That is an ambiguity the fingerprint accepts
		// rather than rejects, since identical code carries identical
		// reasoning.
		const block =
			'export function choose(value: boolean) {\n' + '\treturn value ? 1 : 2;\n' + '}\n';
		const source = block + block;
		const first = mutant('first', 'Survived', 2);
		const second = mutant('second', 'Survived', 5);
		const entry = {
			file: 'src/a.ts',
			mutatorName: first.mutatorName,
			replacement: first.replacement,
			location: first.location,
			sourceHash: sourceWindowHash(source, first.location),
			classification: 'equivalent' as const,
			rationale:
				'The replacement returns the same externally observable value for every valid input.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		await writeFile(path.join(root, 'src/a.ts'), source);
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: { files: { 'src/a.ts': { source, mutants: [first, second] } } }
		});
		expect(verdict.reviewedSurvivors).toBe(2);
		expect(verdict.failures).not.toEqual(
			expect.arrayContaining([expect.stringContaining('stale or no longer survives')])
		);
	});

	it('locates a reviewed window by content: current, stale, or ambiguous', () => {
		const survivor = mutant('reviewed', 'Survived', 2);
		const originalSource =
			'export function choose(value: boolean) {\n' + '\treturn value ? 1 : 2;\n' + '}\n';
		const sourceHash = sourceWindowHash(originalSource, survivor.location);

		// Current: an unrelated line inserted above shifts the mutant's line
		// number, but its window text -- found by search, not by the entry's
		// stale line number -- is unchanged and appears exactly once.
		const shifted = '// a new comment\n' + originalSource;
		expect(sourceWindowStatus(shifted, survivor.location, sourceHash)).toBe('current');

		// Stale: the guarded expression itself changed, so the window text
		// appears nowhere in the file any more.
		const edited = originalSource.replace('value ? 1 : 2', 'value ? 3 : 4');
		expect(sourceWindowStatus(edited, survivor.location, sourceHash)).toBe('stale');

		// Ambiguous: the exact same window text now appears twice, so neither
		// occurrence can be trusted to be the one that was reviewed -- and
		// that is reported the same way as stale.
		const duplicated = originalSource + originalSource;
		expect(sourceWindowStatus(duplicated, survivor.location, sourceHash)).toBe('ambiguous');
	});

	it('preserves the historical Stryker score for the full-tree compatibility audit', async () => {
		const { root, scope } = await fixture();
		scope.lane = 'full';
		scope.project = 'all';
		const source = 'export function choose(value: boolean) { return value ? 1 : 2; }\n';
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'full',
			scope,
			policy,
			report: {
				files: {
					'src/a.ts': {
						source,
						mutants: [
							...Array.from({ length: 7 }, (_, index) => mutant(String(index), 'Killed')),
							mutant('timeout', 'Timeout'),
							mutant('survivor', 'Survived'),
							mutant('uncovered', 'NoCoverage'),
							mutant('compile', 'CompileError')
						]
					}
				}
			}
		});
		expect(verdict.mutationScore).toBe(80);
		expect(verdict.ok).toBe(true);
	});

	it('rejects broad or stale reviewed-mutant entries', async () => {
		const { root, scope } = await fixture();
		const survivor = mutant('reviewed', 'Survived');
		const entry = {
			file: 'src/*.ts',
			mutatorName: survivor.mutatorName,
			replacement: survivor.replacement,
			location: survivor.location,
			sourceHash: '0'.repeat(64),
			classification: 'equivalent' as const,
			rationale: 'A deliberately invalid broad entry that must never classify a concrete survivor.',
			review: 'https://github.com/gabepsilva/Fit_/pull/5'
		};
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: { version: 1, entries: [{ ...entry, fingerprint: mutantFingerprint(entry) }] },
			report: {
				files: {
					'src/a.ts': { source: 'export const a = true;', mutants: [survivor] }
				}
			}
		});
		expect(verdict.failures).toEqual(
			expect.arrayContaining([
				expect.stringContaining('invalid reviewed-mutant entry'),
				expect.stringContaining('changed-line score')
			])
		);
	});

	it('rejects an unsupported ledger version and classification at runtime', async () => {
		const { root, scope } = await fixture();
		const verdict = await evaluateMutationReport({
			projectRoot: root,
			lane: 'security',
			scope,
			policy,
			ledger: {
				version: 2,
				entries: [{ classification: 'all-survivors' }]
			} as unknown as MutationReviewLedger,
			report: { files: {} }
		});
		expect(verdict.failures).toContain(
			'reviewed-mutant ledger must have version 1 and an entries array'
		);
	});
});

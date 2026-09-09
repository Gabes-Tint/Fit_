import { describe, expect, it } from 'vitest';
import { planDone, planNew } from './worktree';

describe('planning a new worktree', () => {
	it('creates at the given path and branch from the given base', () => {
		expect(
			planNew({
				path: '/repo/.claude/worktrees/foo',
				branch: 'foo',
				base: 'origin/main',
				pathExists: false,
				branchExists: false
			})
		).toEqual({
			action: 'create',
			path: '/repo/.claude/worktrees/foo',
			branch: 'foo',
			base: 'origin/main'
		});
	});

	it('refuses a path that already exists', () => {
		expect(
			planNew({
				path: '/repo/.claude/worktrees/foo',
				branch: 'foo',
				base: 'origin/main',
				pathExists: true,
				branchExists: false
			})
		).toEqual({ action: 'refuse', reason: '/repo/.claude/worktrees/foo already exists' });
	});

	it('refuses a branch that already exists, even when the path is free', () => {
		expect(
			planNew({
				path: '/repo/.claude/worktrees/foo',
				branch: 'foo',
				base: 'origin/main',
				pathExists: false,
				branchExists: true
			})
		).toEqual({ action: 'refuse', reason: 'branch foo already exists' });
	});
});

describe('planning a worktree to remove', () => {
	const base = { path: '/repo/.claude/worktrees/foo', branch: 'foo' };

	it('removes a clean, fully pushed worktree and deletes its merged branch', () => {
		expect(planDone({ ...base, dirty: false, aheadCommits: [], force: false })).toEqual({
			action: 'remove',
			path: base.path,
			branch: base.branch,
			deleteBranch: true
		});
	});

	it('refuses uncommitted changes', () => {
		expect(planDone({ ...base, dirty: true, aheadCommits: [], force: false })).toEqual({
			action: 'refuse',
			reasons: [`${base.path} has uncommitted changes`]
		});
	});

	it('refuses commits origin/main has never seen', () => {
		expect(
			planDone({ ...base, dirty: false, aheadCommits: ['abc1234 a commit'], force: false })
		).toEqual({
			action: 'refuse',
			reasons: [`${base.branch} has commits origin/main does not: abc1234 a commit`]
		});
	});

	it('reports both refusals together', () => {
		const plan = planDone({
			...base,
			dirty: true,
			aheadCommits: ['abc1234 a commit'],
			force: false
		});
		expect(plan).toEqual({
			action: 'refuse',
			reasons: [
				`${base.path} has uncommitted changes`,
				`${base.branch} has commits origin/main does not: abc1234 a commit`
			]
		});
	});

	it('force overrides both refusals but never deletes an unmerged branch', () => {
		expect(
			planDone({ ...base, dirty: true, aheadCommits: ['abc1234 a commit'], force: true })
		).toEqual({ action: 'remove', path: base.path, branch: base.branch, deleteBranch: false });
	});
});

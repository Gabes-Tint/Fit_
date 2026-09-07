export type MutationLane = 'security' | 'changed-node' | 'changed-client' | 'full';

export interface LineRange {
	start: number;
	end: number;
}

export interface MutationScopeFile {
	path: string;
	/** Git name-status for a changed production file, or null for fallback background. */
	changeStatus: string | null;
	changedLines: LineRange[];
}

export interface MutationScope {
	version: 2;
	lane: MutationLane;
	project: 'server' | 'client' | 'all';
	base: string | null;
	fallback: string | null;
	files: MutationScopeFile[];
}

export interface MutationLimits {
	aggregateKilled: number;
	perFileKilled: number;
	changedLinesKilled: number;
	maxTimeouts: number;
	maxNoCoverage: number;
	maxErrors: number;
}

export interface MutationPolicy {
	version: 1;
	full: { aggregateScore: number };
	security: MutationLimits;
	changed: MutationLimits;
}

function exactRecord(
	value: unknown,
	keys: readonly string[],
	label: string
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must have exactly keys: ${expected.join(', ')}.`);
	}
	return record;
}

function score(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error(`${label} must be a finite number from 0 through 100.`);
	}
	return value;
}

function count(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function strictLimits(value: unknown, label: string): MutationLimits {
	const limits = exactRecord(
		value,
		[
			'aggregateKilled',
			'perFileKilled',
			'changedLinesKilled',
			'maxTimeouts',
			'maxNoCoverage',
			'maxErrors'
		],
		label
	);
	return {
		aggregateKilled: score(limits.aggregateKilled, `${label}.aggregateKilled`),
		perFileKilled: score(limits.perFileKilled, `${label}.perFileKilled`),
		changedLinesKilled: score(limits.changedLinesKilled, `${label}.changedLinesKilled`),
		maxTimeouts: count(limits.maxTimeouts, `${label}.maxTimeouts`),
		maxNoCoverage: count(limits.maxNoCoverage, `${label}.maxNoCoverage`),
		maxErrors: count(limits.maxErrors, `${label}.maxErrors`)
	};
}

export function parseMutationPolicy(value: unknown): MutationPolicy {
	const policy = exactRecord(value, ['version', 'full', 'security', 'changed'], 'mutation policy');
	if (policy.version !== 1) throw new Error('mutation policy.version must be 1.');
	const full = exactRecord(policy.full, ['aggregateScore'], 'mutation policy.full');
	return {
		version: 1,
		full: { aggregateScore: score(full.aggregateScore, 'mutation policy.full.aggregateScore') },
		security: strictLimits(policy.security, 'mutation policy.security'),
		changed: strictLimits(policy.changed, 'mutation policy.changed')
	};
}

export interface ReviewedMutant {
	fingerprint: string;
	file: string;
	mutatorName: string;
	replacement: string;
	location: { start: { line: number; column: number }; end: { line: number; column: number } };
	sourceHash: string;
	classification: 'equivalent' | 'host-specific-defense-in-depth';
	rationale: string;
	review: string;
	/**
	 * The Stryker status this entry excuses. Defaults to `'Survived'` when
	 * absent, so every entry written before this field existed keeps meaning
	 * exactly what it always meant. An entry for a mutant Stryker can only ever
	 * time out (an unbounded-loop mutation, for example) declares
	 * `'Timeout'` explicitly, so the excuse states which status it is for
	 * rather than matching either one.
	 */
	status?: 'Survived' | 'Timeout';
}

export interface MutationReviewLedger {
	version: 1;
	entries: ReviewedMutant[];
}

export function policyName(lane: MutationLane): keyof Omit<MutationPolicy, 'version'> {
	if (lane === 'security') return 'security';
	if (lane === 'full') return 'full';
	return 'changed';
}

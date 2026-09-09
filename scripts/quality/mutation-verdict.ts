import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type {
	LineRange,
	MutationLane,
	MutationLimits,
	MutationPolicy,
	MutationReviewLedger,
	ReviewedMutant,
	MutationScope
} from './mutation-types';
import { parseMutationPolicy, policyName } from './mutation-types';

interface Position {
	line: number;
	column: number;
}

interface Mutant {
	id: string;
	status: string;
	mutatorName: string;
	replacement: string;
	location: { start: Position; end: Position };
}

interface MutationReport {
	files: Record<string, { source: string; mutants: Mutant[] }>;
}

interface Counts {
	total: number;
	killed: number;
	survived: number;
	timeout: number;
	noCoverage: number;
	errors: number;
}

interface FileVerdict extends Counts {
	file: string;
	killedScore: number;
	/** The change reached no mutable code, so the file carries no strict liability. */
	inertChange: boolean;
	observableChangedTotal: number;
	observableChangedKilled: number;
	reviewedChangedSurvivors: number;
	observableChangedKilledScore: number | null;
}

export interface MutationVerdict extends Counts {
	ok: boolean;
	lane: MutationLane;
	policy: keyof Omit<MutationPolicy, 'version'>;
	verdictMode: 'strict' | 'strict-changed-with-legacy-background' | 'legacy-full';
	killedScore: number;
	/** Stryker-compatible score retained only for the legacy full-tree audit. */
	mutationScore: number;
	strictFiles: number;
	/** Changed files excused from the strict verdict because their diff was inert. */
	inertFiles: number;
	strictKilled: number;
	strictTotal: number;
	strictKilledScore: number;
	strictTimeout: number;
	strictNoCoverage: number;
	strictErrors: number;
	backgroundMutationScore: number | null;
	files: FileVerdict[];
	reviewedSurvivors: number;
	failures: string[];
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REVIEWED_MUTANT_BASE_KEYS = [
	'classification',
	'file',
	'fingerprint',
	'location',
	'mutatorName',
	'rationale',
	'replacement',
	'review',
	'sourceHash'
].sort();

const REVIEWED_MUTANT_KEYS_WITH_STATUS = [...REVIEWED_MUTANT_BASE_KEYS, 'status'].sort();

/** The Stryker status a ledger entry excuses, defaulting to `'Survived'` when the entry omits it. */
function declaredStatus(entry: ReviewedMutant): 'Survived' | 'Timeout' {
	return entry.status ?? 'Survived';
}

function isPosition(value: unknown): value is Position {
	return (
		isRecord(value) &&
		Number.isInteger(value.line) &&
		Number(value.line) >= 1 &&
		Number.isInteger(value.column) &&
		Number(value.column) >= 0
	);
}

function isReviewedMutant(value: unknown): value is ReviewedMutant {
	if (!isRecord(value)) return false;
	const normalized = typeof value.file === 'string' ? path.posix.normalize(value.file) : '';
	const keys = JSON.stringify(Object.keys(value).sort());
	const hasStatus = keys === JSON.stringify(REVIEWED_MUTANT_KEYS_WITH_STATUS);
	return (
		(keys === JSON.stringify(REVIEWED_MUTANT_BASE_KEYS) || hasStatus) &&
		(!hasStatus || value.status === 'Survived' || value.status === 'Timeout') &&
		typeof value.fingerprint === 'string' &&
		typeof value.file === 'string' &&
		typeof value.mutatorName === 'string' &&
		typeof value.replacement === 'string' &&
		isRecord(value.location) &&
		isPosition(value.location.start) &&
		isPosition(value.location.end) &&
		typeof value.sourceHash === 'string' &&
		(value.classification === 'equivalent' ||
			value.classification === 'host-specific-defense-in-depth') &&
		typeof value.rationale === 'string' &&
		typeof value.review === 'string' &&
		!/[*?[\]]/.test(value.file) &&
		!path.posix.isAbsolute(value.file) &&
		normalized === value.file &&
		!normalized.startsWith('../')
	);
}

/** Lines of unchanged context kept on each side of a mutant's own lines. */
const SOURCE_WINDOW_CONTEXT_LINES = 1;

/**
 * Hashes a small window of source around a mutant's location instead of the
 * whole file, so an accepted equivalence stays keyed to the reasoning that
 * justified it -- the mutated line and its immediate neighbors -- rather
 * than to every other line in the file.
 *
 * A whole-file hash is honest about what it cannot see (issue #256's own
 * `idx()`-heuristic example: a change in a different function that could
 * still invalidate the call), but it pays for that by retiring every
 * acceptance in the file on any unrelated edit, including a comment tweak
 * three hundred lines away. This trades that blunt safety for a key that
 * survives unrelated edits and still retires the moment the mutated line (or
 * its immediate context) actually changes.
 */
export function sourceWindowHash(source: string, location: Mutant['location']): string {
	const lines = source.split('\n');
	const start = Math.max(1, location.start.line - SOURCE_WINDOW_CONTEXT_LINES);
	const end = Math.min(lines.length, location.end.line + SOURCE_WINDOW_CONTEXT_LINES);
	return sha256(lines.slice(start - 1, end).join('\n'));
}

/**
 * Counts how many windows of the given span length, anywhere in `source`,
 * hash to `targetHash` -- the search `mutation-review-check.ts` uses to find
 * a reviewed mutant's window without trusting the ledger entry's own line
 * numbers, which an edit above the mutant leaves pointing at the wrong text.
 */
export function sourceWindowOccurrences(
	source: string,
	spanLines: number,
	targetHash: string
): number {
	const lines = source.split('\n');
	let matches = 0;
	for (let startLine = 1; startLine + spanLines - 1 <= lines.length; startLine++) {
		const endLine = startLine + spanLines - 1;
		const start = Math.max(1, startLine - SOURCE_WINDOW_CONTEXT_LINES);
		const end = Math.min(lines.length, endLine + SOURCE_WINDOW_CONTEXT_LINES);
		if (sha256(lines.slice(start - 1, end).join('\n')) === targetHash) matches += 1;
	}
	return matches;
}

/**
 * Where a reviewed mutant's window stands in the current source: `'current'`
 * when its exact window text appears exactly once, `'stale'` when it appears
 * nowhere, and `'ambiguous'` -- treated as stale, since neither occurrence
 * can be trusted to be the reviewed one -- when it appears more than once.
 *
 * This reads only the entry's span length (`end.line - start.line`, which
 * survives a shift the same way the window hash does) from `location`, never
 * its absolute line numbers, because an edit above the mutant leaves those
 * numbers pointing at the wrong text.
 */
export function sourceWindowStatus(
	source: string,
	location: { start: Position; end: Position },
	sourceHash: string
): 'current' | 'stale' | 'ambiguous' {
	const spanLines = location.end.line - location.start.line + 1;
	const matches = sourceWindowOccurrences(source, spanLines, sourceHash);
	if (matches === 0) return 'stale';
	if (matches === 1) return 'current';
	return 'ambiguous';
}

/**
 * Identifies a reviewed mutant by its code, not its coordinates.
 *
 * `location` is deliberately left out of this hash. A line inserted above a
 * mutant -- an unrelated import, a comment, a new function earlier in the
 * file -- shifts every line number below it without touching the mutant's
 * own text, and `sourceHash` (a window of that unchanged text) already
 * proves nothing relevant moved. Hashing `location` on top of that would
 * fingerprint the shift, not the code, and retire the acceptance for a
 * reason it was never supposed to answer to. `location` still travels with
 * the ledger entry for a human to read and `mutation-repin.ts` to update,
 * it just never reaches this hash.
 *
 * The trade this accepts: two mutants in the same file, same mutator, same
 * replacement, whose windows hash identically (the same few lines of code
 * appearing twice) collapse onto one fingerprint. One review then excuses
 * both. That is treated as correct rather than as an ambiguity to reject --
 * identical code carries identical reasoning -- but it does mean a ledger
 * entry can silently cover a second, unreviewed occurrence if one ever
 * appears.
 */
export function mutantFingerprint(input: {
	file: string;
	mutatorName: string;
	replacement: string;
	sourceHash: string;
}): string {
	return sha256(
		JSON.stringify({
			file: input.file,
			mutatorName: input.mutatorName,
			replacement: input.replacement,
			sourceHash: input.sourceHash
		})
	);
}

interface ReviewedFingerprint {
	file: string;
	status: 'Survived' | 'Timeout';
}

function reviewedFingerprints(
	ledger: MutationReviewLedger,
	expected: ReadonlySet<string>,
	failures: string[]
): Map<string, ReviewedFingerprint> {
	const fingerprints = new Map<string, ReviewedFingerprint>();
	const seen = new Set<string>();
	if (!isRecord(ledger) || ledger.version !== 1 || !Array.isArray(ledger.entries)) {
		failures.push('reviewed-mutant ledger must have version 1 and an entries array');
		return fingerprints;
	}
	for (const candidate of ledger.entries as unknown[]) {
		if (!isReviewedMutant(candidate)) {
			failures.push('invalid reviewed-mutant entry: malformed or non-exact schema');
			continue;
		}
		const entry = candidate;
		const recomputed = mutantFingerprint(entry);
		if (
			entry.fingerprint !== recomputed ||
			!/^[a-f0-9]{64}$/.test(entry.sourceHash) ||
			entry.rationale.trim().length < 40 ||
			!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(entry.review)
		) {
			failures.push(`invalid reviewed-mutant entry: ${entry.file} ${entry.fingerprint}`);
			continue;
		}
		if (seen.has(entry.fingerprint)) {
			failures.push(`duplicate reviewed-mutant fingerprint: ${entry.fingerprint}`);
			continue;
		}
		seen.add(entry.fingerprint);
		if (expected.has(entry.file))
			fingerprints.set(entry.fingerprint, { file: entry.file, status: declaredStatus(entry) });
	}
	return fingerprints;
}

export function mutationReviewLedgerFailures(value: unknown): string[] {
	const failures: string[] = [];
	reviewedFingerprints(value as MutationReviewLedger, new Set(), failures);
	return failures;
}

function blankCounts(): Counts {
	return { total: 0, killed: 0, survived: 0, timeout: 0, noCoverage: 0, errors: 0 };
}

function addStatus(counts: Counts, status: string): void {
	counts.total += 1;
	if (status === 'Killed') counts.killed += 1;
	else if (status === 'Survived') counts.survived += 1;
	else if (status === 'Timeout') counts.timeout += 1;
	else if (status === 'NoCoverage') counts.noCoverage += 1;
	else counts.errors += 1;
}

function percent(killed: number, total: number): number {
	return total === 0 ? 100 : (killed / total) * 100;
}

function compatibleMutationScore(counts: Counts): number {
	const valid = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
	return percent(counts.killed + counts.timeout, valid);
}

function intersectsLines(start: number, end: number, ranges: readonly LineRange[]): boolean {
	return ranges.some((range) => start <= range.end && end >= range.start);
}

function intersects(location: Mutant['location'], ranges: readonly LineRange[]): boolean {
	return intersectsLines(location.start.line, location.end.line, ranges);
}

/**
 * Where Stryker anchored a mutant, as opposed to how far it reaches.
 *
 * A `BlockStatement` mutant replaces a whole function body, so it *intersects*
 * every comment inside that function while being anchored to the brace far
 * above. Asking about the anchor is what separates "Stryker mutated this line"
 * from "Stryker mutated something that happens to span this line".
 */
function startsOnChangedLine(location: Mutant['location'], ranges: readonly LineRange[]): boolean {
	return intersectsLines(location.start.line, location.start.line, ranges);
}

function isDeclarationOnly(statement: ts.Statement): boolean {
	if (
		ts.isImportDeclaration(statement) ||
		ts.isExportDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isEmptyStatement(statement)
	) {
		return true;
	}
	return (
		ts.canHaveModifiers(statement) &&
		ts
			.getModifiers(statement)
			?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) === true
	);
}

function hasMutationCandidate(source: string, file: string): boolean {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	// Fail closed: an omitted file is safe only when it has no statements Stryker can mutate.
	return parsed.statements.some((statement) => !isDeclarationOnly(statement));
}

/**
 * Whether a file's changed lines reach code Stryker could mutate.
 *
 * The strict verdict below judges a changed file on every mutant it holds, not
 * only the ones its diff produced, so that editing a function means answering
 * for the file that has to hold it up. A diff that only rewrites a comment
 * reaches no behavior at all, and charging it the file's whole history measures
 * how wide a change is rather than how much it risks.
 *
 * The question is put to the syntax rather than to the mutant list, because
 * Stryker has no mutator for a renamed call target: counting mutants alone
 * would wave a real behavior change through. Comments and blank lines are
 * trivia and carry no token, and imports, interfaces and type aliases are the
 * same declarations `hasMutationCandidate` already treats as beyond Stryker's
 * reach.
 */
function changedLinesReachMutableCode(
	source: string,
	file: string,
	ranges: readonly LineRange[]
): boolean {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const line = (position: number) => parsed.getLineAndCharacterOfPosition(position).line + 1;
	// Only a token pins code to a line. Every node above one spans its whole
	// subtree, so asking a statement would report a comment buried inside a long
	// function as code. JSDoc is the exception that has to be named: it hangs off
	// the tree as a childless node rather than as trivia, and it is the very
	// thing being excluded.
	const reaches = (node: ts.Node): boolean => {
		if (ts.isJSDoc(node)) return false;
		const children = node.getChildren(parsed);
		return children.length === 0
			? intersectsLines(line(node.getStart(parsed)), line(node.getEnd()), ranges)
			: children.some(reaches);
	};
	return parsed.statements.some((statement) => !isDeclarationOnly(statement) && reaches(statement));
}

async function missingExecutableFiles(
	projectRoot: string,
	scope: MutationScope,
	reported: ReadonlySet<string>
): Promise<string[]> {
	const missing: string[] = [];
	for (const { path: file } of scope.files) {
		if (reported.has(file)) continue;
		const source = await readFile(path.join(projectRoot, file), 'utf8');
		if (hasMutationCandidate(source, file)) missing.push(file);
	}
	return missing;
}

function limitsFor(policy: MutationPolicy, lane: Exclude<MutationLane, 'full'>): MutationLimits {
	return lane === 'security' ? policy.security : policy.changed;
}

export async function evaluateMutationReport(options: {
	projectRoot: string;
	lane: MutationLane;
	scope: MutationScope;
	report: MutationReport;
	policy: MutationPolicy;
	ledger?: MutationReviewLedger;
}): Promise<MutationVerdict> {
	const { projectRoot, lane, scope, report, policy } = options;
	const limits = lane === 'full' ? null : limitsFor(policy, lane);
	// Only a diff-scoped lane can excuse anything. `full` judges the whole tree
	// and `security` judges the security closure; neither asks what changed, so
	// naming the two positively keeps a lane added later out until it opts in.
	const diffScopedLane = lane === 'changed-node' || lane === 'changed-client';
	const failures: string[] = [];
	if (scope.version !== 2) failures.push('mutation scope must have version 2');
	for (const file of scope.files) {
		if (
			file.changeStatus !== null &&
			(typeof file.changeStatus !== 'string' || file.changeStatus.length === 0)
		) {
			failures.push(`mutation scope has invalid change status: ${file.path}`);
		}
	}
	const expected = new Set(scope.files.map(({ path: file }) => file));
	const changed = new Map(scope.files.map(({ path: file, changedLines }) => [file, changedLines]));
	const changeStatuses = new Map(
		scope.files.map(({ path: file, changeStatus }) => [file, changeStatus])
	);
	const reportEntries = Object.entries(report.files).sort(([left], [right]) =>
		left.localeCompare(right)
	);
	const actual = new Set(reportEntries.map(([file]) => file));
	const reviewed = reviewedFingerprints(
		options.ledger ?? { version: 1, entries: [] },
		expected,
		failures
	);
	const matchedReviewed = new Set<string>();
	const unexpected = [...actual].filter((file) => !expected.has(file));
	if (unexpected.length > 0)
		failures.push(`report contains files outside scope: ${unexpected.join(', ')}`);
	const missing = await missingExecutableFiles(projectRoot, scope, actual);
	if (missing.length > 0)
		failures.push(`report omitted executable scoped files: ${missing.join(', ')}`);
	if (lane === 'security' && scope.files.length === 0) failures.push('security scope is empty');

	const aggregate = blankCounts();
	const strictAggregate = blankCounts();
	const backgroundAggregate = blankCounts();
	const files: FileVerdict[] = [];
	let strictFiles = 0;
	let inertFiles = 0;
	let reviewedSurvivors = 0;
	for (const [file, fileReport] of reportEntries) {
		const counts = blankCounts();
		let observableChangedTotal = 0;
		let observableChangedKilled = 0;
		let reviewedChangedSurvivors = 0;
		let anchorsAChangedLine = false;
		let verifiedSource = fileReport.source;
		if (expected.has(file)) {
			verifiedSource = await readFile(path.join(projectRoot, file), 'utf8');
			if (verifiedSource !== fileReport.source) {
				failures.push(`report source does not match scoped file: ${file}`);
			}
		}
		const changedLines = changed.get(file) ?? [];
		for (const mutant of fileReport.mutants) {
			const fingerprint = mutantFingerprint({
				file,
				mutatorName: mutant.mutatorName,
				replacement: mutant.replacement,
				sourceHash: sourceWindowHash(verifiedSource, mutant.location)
			});
			const reviewedEntry = reviewed.get(fingerprint);
			const isReviewed = reviewedEntry !== undefined && mutant.status === reviewedEntry.status;
			if (isReviewed) {
				matchedReviewed.add(fingerprint);
				reviewedSurvivors += 1;
			}
			addStatus(counts, mutant.status);
			addStatus(aggregate, mutant.status);
			if (startsOnChangedLine(mutant.location, changedLines)) anchorsAChangedLine = true;
			if (intersects(mutant.location, changedLines)) {
				if (isReviewed) reviewedChangedSurvivors += 1;
				else {
					observableChangedTotal += 1;
					if (mutant.status === 'Killed') observableChangedKilled += 1;
				}
			}
		}
		/*
		 * A change is inert when it provably touches nothing this gate can judge:
		 * it leaves lines in the new source to reason about, Stryker anchored no
		 * mutant to any of them, and none of them reach mutable code. A pure
		 * deletion leaves no changed lines at all and so stays strict -- absence of
		 * evidence is not evidence, and the file still has to hold up what remains.
		 *
		 * The mutant clause is not implied by the syntax one: it fails closed if the
		 * two ever disagree, and it is cheap, so it is asked before the source is
		 * parsed.
		 */
		const inertChange =
			diffScopedLane &&
			changedLines.length > 0 &&
			!anchorsAChangedLine &&
			!changedLinesReachMutableCode(verifiedSource, file, changedLines);
		if (inertChange) inertFiles += 1;
		const fileVerdict: FileVerdict = {
			file,
			...counts,
			inertChange,
			killedScore: percent(counts.killed, counts.total),
			observableChangedTotal,
			observableChangedKilled,
			reviewedChangedSurvivors,
			observableChangedKilledScore:
				observableChangedTotal === 0
					? null
					: percent(observableChangedKilled, observableChangedTotal)
		};
		files.push(fileVerdict);
		const strictFile =
			lane === 'security' ||
			(lane !== 'full' &&
				!inertChange &&
				(scope.fallback === null || changeStatuses.get(file) !== null));
		if (strictFile) {
			strictFiles += 1;
			for (const mutant of fileReport.mutants) addStatus(strictAggregate, mutant.status);
		} else if (lane !== 'full') {
			for (const mutant of fileReport.mutants) addStatus(backgroundAggregate, mutant.status);
		}
		if (limits !== null && strictFile && fileVerdict.killedScore < limits.perFileKilled) {
			failures.push(
				`${file} killed-only score ${fileVerdict.killedScore.toFixed(2)} is below ${limits.perFileKilled}`
			);
		}
		if (
			fileVerdict.observableChangedKilledScore !== null &&
			limits !== null &&
			fileVerdict.observableChangedKilledScore < limits.changedLinesKilled
		) {
			failures.push(
				`${file} observable changed-line score ${fileVerdict.observableChangedKilledScore.toFixed(2)} is below ${limits.changedLinesKilled}`
			);
		}
	}
	for (const [fingerprint, { file }] of reviewed) {
		if (!matchedReviewed.has(fingerprint)) {
			failures.push(`reviewed mutant is stale or no longer survives: ${file} ${fingerprint}`);
		}
	}

	const killedScore = percent(aggregate.killed, aggregate.total);
	const mutationScore = compatibleMutationScore(aggregate);
	const strictKilledScore = percent(strictAggregate.killed, strictAggregate.total);
	const backgroundMutationScore =
		lane !== 'full' && scope.fallback !== null
			? compatibleMutationScore(backgroundAggregate)
			: null;
	if (scope.files.length > 0 && aggregate.total === 0) failures.push('scope produced no mutants');
	if (limits === null && mutationScore < policy.full.aggregateScore) {
		failures.push(
			`full-tree mutation score ${mutationScore.toFixed(2)} is below ${policy.full.aggregateScore}`
		);
	}
	if (
		lane !== 'full' &&
		scope.fallback !== null &&
		backgroundAggregate.total > 0 &&
		backgroundMutationScore !== null &&
		backgroundMutationScore < policy.full.aggregateScore
	) {
		failures.push(
			`unchanged fallback background mutation score ${backgroundMutationScore.toFixed(2)} is below ${policy.full.aggregateScore}`
		);
	}
	if (limits !== null && strictAggregate.total > 0 && strictKilledScore < limits.aggregateKilled) {
		failures.push(
			`strict changed aggregate killed-only score ${strictKilledScore.toFixed(2)} is below ${limits.aggregateKilled}`
		);
	}
	if (limits !== null && strictAggregate.timeout > limits.maxTimeouts) {
		failures.push(
			`strict changed timeouts ${strictAggregate.timeout} exceed ${limits.maxTimeouts}`
		);
	}
	if (limits !== null && strictAggregate.noCoverage > limits.maxNoCoverage) {
		failures.push(
			`strict changed uncovered mutants ${strictAggregate.noCoverage} exceed ${limits.maxNoCoverage}`
		);
	}
	if (limits !== null && strictAggregate.errors > limits.maxErrors) {
		failures.push(
			`strict changed errored mutants ${strictAggregate.errors} exceed ${limits.maxErrors}`
		);
	}

	return {
		ok: failures.length === 0,
		lane,
		policy: policyName(lane),
		verdictMode:
			lane === 'full'
				? 'legacy-full'
				: scope.fallback === null
					? 'strict'
					: 'strict-changed-with-legacy-background',
		...aggregate,
		killedScore,
		mutationScore,
		strictFiles,
		inertFiles,
		strictKilled: strictAggregate.killed,
		strictTotal: strictAggregate.total,
		strictKilledScore,
		strictTimeout: strictAggregate.timeout,
		strictNoCoverage: strictAggregate.noCoverage,
		strictErrors: strictAggregate.errors,
		backgroundMutationScore,
		files,
		reviewedSurvivors,
		failures
	};
}

/**
 * How far a report's mtime may sit behind the moment the run started.
 *
 * The check below weighs a wall-clock reading against a filesystem timestamp,
 * and the two are allowed to disagree a little. Linux stamps an inode from the
 * coarse clock, which advances once per timer tick rather than continuously,
 * and some filesystems store the field to whole seconds and truncate. Either
 * way a file written just after `Date.now()` can carry an mtime fractionally
 * before it.
 *
 * Comparing them exactly made this a race, and one path always lost it. A
 * changed lane with an empty scope skips Stryker and writes its empty report
 * microseconds after the run begins, so every pull request that touched no
 * mutated file failed with "Mutation report is stale." on a runner whose tick
 * is coarse enough, while a run that spent minutes in Stryker never noticed.
 * A margin ends that without weakening anything: it is orders of magnitude
 * above any tick and orders of magnitude below real staleness, because the
 * report this guards against belongs to an earlier run and
 * `resetMutationResultArtifacts` has already deleted this lane's copy on the
 * way in.
 */
const CLOCK_MARGIN_MS = 1000;

export async function verifyMutationFiles(options: {
	projectRoot: string;
	lane: MutationLane;
	scopePath: string;
	reportPath: string;
	policyPath: string;
	verdictPath: string;
	ledgerPath: string;
	startedAt: number;
}): Promise<MutationVerdict> {
	const reportStats = await stat(options.reportPath);
	if (reportStats.mtimeMs < options.startedAt - CLOCK_MARGIN_MS)
		throw new Error('Mutation report is stale.');
	const [scope, report, policy, ledger] = await Promise.all([
		readFile(options.scopePath, 'utf8').then((value) => JSON.parse(value) as MutationScope),
		readFile(options.reportPath, 'utf8').then((value) => JSON.parse(value) as MutationReport),
		readFile(options.policyPath, 'utf8').then((value) => parseMutationPolicy(JSON.parse(value))),
		readFile(options.ledgerPath, 'utf8').then((value) => JSON.parse(value) as MutationReviewLedger)
	]);
	if (scope.lane !== options.lane) {
		throw new Error(`Scope lane ${scope.lane} does not match requested lane ${options.lane}.`);
	}
	const verdict = await evaluateMutationReport({
		projectRoot: options.projectRoot,
		lane: options.lane,
		scope,
		report,
		policy,
		ledger
	});
	await writeFile(options.verdictPath, `${JSON.stringify(verdict, null, '\t')}\n`);
	return verdict;
}

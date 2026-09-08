/**
 * A small parser over one source file, pulling the literal SQL out of every
 * `prepared(db, ...)` and `db.prepare(...)` call site so instrument 4 can run
 * `EXPLAIN QUERY PLAN` against it without a person re-typing the statement by
 * hand into a second file that could drift from the real one.
 *
 * Deliberately narrow: it reads template and string literals, and follows
 * exactly one `${IDENTIFIER}` interpolation back to a same-file
 * `const NAME = `...`;` (the one real case in this tree, `FOOD_COLUMNS` in
 * `foods.ts`). A call site built from a function call — `searchSql(columns)`,
 * `servingRowsSql(ids.length)` — is not evaluated; it is reported as
 * unresolved, by name, so the report says what it could not check rather than
 * silently checking less than it claims.
 */

export interface ExtractedStatement {
	/** The enclosing function, or `(module scope)` when none was found. */
	label: string;
	sql: string;
}

export interface UnresolvedStatement {
	label: string;
	/** What stood in place of a literal — enough to find the call site by eye. */
	snippet: string;
}

export interface ParsedFile {
	statements: ExtractedStatement[];
	unresolved: UnresolvedStatement[];
}

/** Top-level `const NAME = `...`;` declarations, the only substitution this parser does. */
function moduleConstants(source: string): Map<string, string> {
	const constants = new Map<string, string>();
	const pattern = /^const ([A-Z][A-Z0-9_]*)\s*=\s*`([\s\S]*?)`;/gm;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const name = match[1];
		const value = match[2];
		if (name !== undefined && value !== undefined) constants.set(name, value);
	}
	return constants;
}

/** The nearest enclosing `function name(` (with or without `export`) before `index`. */
function enclosingFunction(source: string, index: number): string {
	const before = source.slice(0, index);
	const pattern = /(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
	let name = '(module scope)';
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(before)) !== null) {
		name = match[1] ?? name;
	}
	return name;
}

type LiteralResult =
	{ kind: 'literal'; sql: string; end: number } | { kind: 'dynamic'; snippet: string };

/** A quoted string literal (`'`or `"`), starting at `source[start]` which is the quote. */
function parseQuoted(source: string, start: number): LiteralResult {
	const quote = source[start];
	let text = '';
	let index = start + 1;
	while (index < source.length) {
		const char = source[index];
		if (char === '\\') {
			text += source.slice(index, index + 2);
			index += 2;
			continue;
		}
		if (char === quote) return { kind: 'literal', sql: text, end: index + 1 };
		text += char;
		index += 1;
	}
	return { kind: 'dynamic', snippet: source.slice(start, Math.min(source.length, start + 80)) };
}

/**
 * A template literal starting at `source[start]` (a backtick). Substitutes at
 * most the known module constants for a `${IDENTIFIER}` interpolation; any
 * other interpolation, or an unknown identifier, makes the whole statement
 * dynamic.
 */
function parseTemplate(
	source: string,
	start: number,
	constants: Map<string, string>
): LiteralResult {
	let text = '';
	let index = start + 1;
	while (index < source.length) {
		const char = source[index];
		if (char === '\\') {
			text += source.slice(index, index + 2);
			index += 2;
			continue;
		}
		if (char === '`') return { kind: 'literal', sql: text, end: index + 1 };
		if (char === '$' && source[index + 1] === '{') {
			const closing = source.indexOf('}', index + 2);
			if (closing === -1) break;
			const identifier = source.slice(index + 2, closing).trim();
			const value = /^[A-Za-z0-9_]+$/.test(identifier) ? constants.get(identifier) : undefined;
			if (value === undefined) {
				return {
					kind: 'dynamic',
					snippet: source.slice(start, Math.min(source.length, closing + 1))
				};
			}
			text += value;
			index = closing + 1;
			continue;
		}
		text += char;
		index += 1;
	}
	return { kind: 'dynamic', snippet: source.slice(start, Math.min(source.length, start + 80)) };
}

/** The literal (or the reason there is none) starting at the first non-space character at or after `from`. */
function parseArgument(
	source: string,
	from: number,
	constants: Map<string, string>
): LiteralResult {
	let index = from;
	while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
	const char = source[index];
	if (char === '`') return parseTemplate(source, index, constants);
	if (char === "'" || char === '"') return parseQuoted(source, index);
	// Not a literal at all — a call, an identifier, a spread. Report the call
	// site rather than guessing at its value.
	const end = source.indexOf(')', index);
	const stop = end === -1 ? Math.min(source.length, index + 80) : Math.min(end + 1, index + 80);
	return { kind: 'dynamic', snippet: source.slice(index, stop).trim() };
}

/** Every `prepared(db, ...)` and `.prepare(...)` call site in one file's source. */
export function parseFile(source: string): ParsedFile {
	const constants = moduleConstants(source);
	const statements: ExtractedStatement[] = [];
	const unresolved: UnresolvedStatement[] = [];
	const seen = new Map<string, number>();

	function record(label: string, argumentStart: number): void {
		const count = seen.get(label) ?? 0;
		seen.set(label, count + 1);
		const numbered = count === 0 ? label : `${label} (${count + 1})`;
		const result = parseArgument(source, argumentStart, constants);
		if (result.kind === 'literal') statements.push({ label: numbered, sql: result.sql.trim() });
		else unresolved.push({ label: numbered, snippet: result.snippet });
	}

	const preparedCall = /\bprepared\(\s*[A-Za-z_$][\w$]*\s*,/g;
	let match: RegExpExecArray | null;
	while ((match = preparedCall.exec(source)) !== null) {
		record(enclosingFunction(source, match.index), match.index + match[0].length);
	}

	const prepareMethod = /\.prepare\(/g;
	while ((match = prepareMethod.exec(source)) !== null) {
		record(enclosingFunction(source, match.index), match.index + match[0].length);
	}

	return { statements, unresolved };
}

import { SCHEMA_VERSION, stateFormat, storedDocument } from './state-document';
import type { LogItem, Meal, Profile, TendState } from './types';
import { MEALS, ZERO_MICROS } from './types';
import { todayISO } from './utils';

/**
 * The whole state as a file someone can keep. It describes its own shape the
 * way every other copy of the document does — the label and the version come
 * from `state-document.ts` rather than being spelled out here, so an export
 * taken after a shape change says which shape it is rather than the shape that
 * happened to be current when this line was written.
 */
export function exportJson(state: TendState) {
	return JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			format: stateFormat(SCHEMA_VERSION),
			...storedDocument(state)
		},
		null,
		2
	);
}

/** Columns in order; header and value are paired so a new column can't land under the wrong heading. */
const CSV_COLUMNS: { header: string; value: (item: LogItem) => string | number }[] = [
	{ header: 'date', value: (i) => i.date },
	{ header: 'meal', value: (i) => i.meal },
	{ header: 'name', value: (i) => i.name },
	{ header: 'brand', value: (i) => i.brand ?? '' },
	{ header: 'servings', value: (i) => i.servings },
	{ header: 'serving_label', value: (i) => i.servingLabel },
	{ header: 'kcal', value: (i) => i.kcal },
	{ header: 'protein_g', value: (i) => i.protein },
	{ header: 'carbs_g', value: (i) => i.carbs },
	{ header: 'fat_g', value: (i) => i.fat },
	{ header: 'fiber_g', value: (i) => i.micros.fiber },
	{ header: 'sodium_mg', value: (i) => i.micros.sodium },
	{ header: 'potassium_mg', value: (i) => i.micros.potassium },
	{ header: 'iron_mg', value: (i) => i.micros.iron },
	{ header: 'b12_mcg', value: (i) => i.micros.vitaminB12 },
	{ header: 'provenance', value: (i) => i.provenance ?? '' },
	{ header: 'source', value: (i) => i.source }
];

export function exportCsv(profile: Profile) {
	const rows = [...profile.log]
		.sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal))
		.map((item) => CSV_COLUMNS.map((column) => csv(String(column.value(item)))).join(','));
	return [CSV_COLUMNS.map((column) => column.header).join(','), ...rows].join('\n');
}

function csv(s: string) {
	if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

/** Best-effort MyFitnessPal daily summary / diary CSV. */
export function parseMfpCsv(text: string) {
	// A paste with no first line has no header to key the columns on. Past that,
	// a header naming no food column and a paste with no rows both come out as
	// no rows below, so neither is worth a second early return.
	const [headerLine, ...rows] = text.split(/\r?\n/).filter((l) => l.trim().length);
	if (headerLine === undefined) return [];
	// Matched as a substring, so surrounding spaces in a pasted heading are
	// already tolerated and trimming one would change nothing.
	const header = splitCsv(headerLine).map((h) => h.toLowerCase());
	const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
	const dateI = idx(['date']);
	const nameI = idx(['name', 'food', 'item']);
	const kcalI = idx(['calories', 'kcal', 'energy']);
	const pI = idx(['protein']);
	const cI = idx(['carb']);
	const fI = idx(['fat']);
	const mealI = idx(['meal', 'folder']);

	const out: {
		date: string;
		name: string;
		meal: string;
		kcal: number;
		protein: number;
		carbs: number;
		fat: number;
	}[] = [];

	for (const line of rows) {
		const cols = splitCsv(line);
		const name = cols[nameI]?.trim();
		// Summary rows ("Totals", "Goal", "Remaining") are not food.
		if (!name || /^(total|goal|remaining|foods)/i.test(name)) continue;
		out.push({
			// `idx` answers -1 for a heading the paste lacks, and `cols[-1]` is the
			// same undefined the guarded form used to pass in.
			date: rowDate(cols[dateI]),
			name,
			meal: (cols[mealI] ?? 'snack').toLowerCase(),
			kcal: num(cols[kcalI]),
			protein: num(cols[pI]),
			carbs: num(cols[cI]),
			fat: num(cols[fI])
		});
	}
	return out;
}

/** Anything that is not a plain ISO date falls back to today. */
function rowDate(raw: string | undefined) {
	if (raw === undefined) return todayISO();
	const date = raw.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
}

function num(s: string | undefined) {
	if (s === undefined) return 0;
	const n = Number(s.replace(/[^0-9.-]/g, ''));
	return Number.isFinite(n) ? n : 0;
}

function splitCsv(line: string) {
	const chars = [...line];
	const out: string[] = [];
	let cur = '';
	let q = false;
	// The second half of a doubled quote is skipped by this flag rather than by
	// winding the loop index on: an index the body moves can be mutated into a
	// loop that never ends, which no test can do anything about.
	let skipNext = false;
	for (const [i, ch] of chars.entries()) {
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (ch === '"') {
			if (q && chars[i + 1] === '"') {
				cur += '"';
				skipNext = true;
			} else q = !q;
		} else if (ch === ',' && !q) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

/** How many imported rows are accepted in one paste. */
export const MFP_IMPORT_LIMIT = 80;

/**
 * Turn parsed MyFitnessPal rows into log entries. They carry no `foodId`, so
 * the micros are zeroed rather than invented.
 */
export function mfpRowsToLogItems(
	rows: ReturnType<typeof parseMfpCsv>,
	makeId: () => string
): LogItem[] {
	return rows.slice(0, MFP_IMPORT_LIMIT).map((r) => ({
		id: makeId(),
		foodId: null,
		date: r.date,
		meal: MEALS.find((m): m is Meal => m === r.meal) ?? 'snack',
		servings: 1,
		source: 'manual',
		name: r.name,
		kcal: r.kcal,
		protein: r.protein,
		carbs: r.carbs,
		fat: r.fat,
		micros: { ...ZERO_MICROS },
		servingLabel: 'imported'
	}));
}

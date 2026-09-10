/**
 * Issue #338: which catalog rows state a kcal per 100 g that their own macros
 * cannot explain.
 *
 * `assessPlausibility` (./plausibility.ts) is the physical check: kcal within
 * ±15% of the Atwater estimate from protein/carbs/fat/alcohol/fibre, and never
 * above 900 regardless. This script runs that check over every row of a built
 * catalog, groups the failures by `value_source` (and `category`, where the
 * row has one), and prints a sample so a human can tell an oil or a hard candy
 * — genuinely dense foods — from a mis-scaled per-serving value posing as
 * per-100g.
 *
 * It only reads. It never deletes or rewrites a row, and it does not change
 * the core catalog's quality filter (`data/scripts/export_sqlite.py`) — that
 * is a decision for a human, made with these numbers in hand.
 *
 *   node scripts/etl/plausibility-audit.ts
 *   node scripts/etl/plausibility-audit.ts --db data/db/fit-food-full.sqlite
 *   node scripts/etl/plausibility-audit.ts --json reports/etl/plausibility.json
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { catalogPath } from '../../src/lib/server/catalog/connection.ts';
import { assessPlausibility, type MacroRow } from './plausibility.ts';

/** How many names to print per `value_source`, worst deviation first. */
const SAMPLE_SIZE = 10;

/** How many categories to print per source before summarizing the rest. */
const CATEGORY_SAMPLE = 15;

type FoodRow = MacroRow & {
	name: string;
	valueSource: string;
	category: string | null;
	servingLabel: string | null;
	servingG: number | null;
};

type FailingRow = FoodRow & { atwaterLower: number; atwaterUpper: number; deviation: number };

type SourceGroup = {
	source: string;
	total: number;
	failing: FailingRow[];
	skipped: number;
};

/** `--json path --db path`, the only flags this runner understands. */
function options(argv: string[]): { json: string | null; db: string | null } {
	const read = (flag: string): string | null => {
		const at = argv.indexOf(flag);
		return at === -1 ? null : (argv[at + 1] ?? null);
	};
	return { json: read('--json'), db: read('--db') };
}

function readRows(db: DatabaseSync): FoodRow[] {
	const rows = db
		.prepare(
			`select name, value_source, category, serving_label, serving_g,
				kcal, protein, carbs, fat, fiber
			from food`
		)
		.all();
	return rows.map((row) => ({
		name: String(row['name']),
		valueSource: String(row['value_source']),
		category: row['category'] === null ? null : String(row['category']),
		servingLabel: row['serving_label'] === null ? null : String(row['serving_label']),
		servingG: row['serving_g'] === null ? null : Number(row['serving_g']),
		kcal: row['kcal'] === null ? null : Number(row['kcal']),
		protein: row['protein'] === null ? null : Number(row['protein']),
		carbs: row['carbs'] === null ? null : Number(row['carbs']),
		fat: row['fat'] === null ? null : Number(row['fat']),
		fiber: row['fiber'] === null ? null : Number(row['fiber']),
		// The core catalog carries no alcohol column; a food catalog that grows
		// one only needs `readRows` extended, not `assessPlausibility`.
		alcohol: null
	}));
}

function groupBySource(rows: FoodRow[]): SourceGroup[] {
	const groups = new Map<string, SourceGroup>();
	for (const row of rows) {
		const group = groups.get(row.valueSource) ?? {
			source: row.valueSource,
			total: 0,
			failing: [],
			skipped: 0
		};
		group.total += 1;
		const verdict = assessPlausibility(row);
		if (verdict.status === 'skipped') {
			group.skipped += 1;
		} else if (verdict.status === 'fail') {
			const midpoint = (verdict.atwaterLower + verdict.atwaterUpper) / 2;
			const deviation =
				midpoint === 0 ? Math.abs(row.kcal ?? 0) : Math.abs((row.kcal ?? 0) - midpoint) / midpoint;
			group.failing.push({
				...row,
				atwaterLower: verdict.atwaterLower,
				atwaterUpper: verdict.atwaterUpper,
				deviation
			});
		}
		groups.set(row.valueSource, group);
	}
	return [...groups.values()].sort((a, b) => b.failing.length - a.failing.length);
}

function categoryCounts(rows: FailingRow[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = row.category ?? '(no category)';
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function macroCell(row: FoodRow): string {
	const part = (label: string, value: number | null): string =>
		value === null ? `${label}=–` : `${label}=${value}`;
	return [
		part('p', row.protein),
		part('c', row.carbs),
		part('f', row.fat),
		part('fib', row.fiber)
	].join(' ');
}

function servingCell(row: FoodRow): string {
	if (row.servingG === null) return row.servingLabel ?? '–';
	return row.servingLabel === null
		? `${row.servingG} g`
		: `${row.servingLabel} (${row.servingG} g)`;
}

function printGroup(group: SourceGroup): void {
	console.log(
		`\n${group.source} — total ${group.total}, failing ${group.failing.length}, skipped ${group.skipped}`
	);
	if (group.failing.length === 0) return;

	const categories = categoryCounts(group.failing);
	console.log('  by category:');
	for (const [category, count] of categories.slice(0, CATEGORY_SAMPLE)) {
		console.log(`    ${category}: ${count}`);
	}
	if (categories.length > CATEGORY_SAMPLE) {
		console.log(`    … and ${categories.length - CATEGORY_SAMPLE} more categories`);
	}

	const worst = [...group.failing].sort((a, b) => b.deviation - a.deviation).slice(0, SAMPLE_SIZE);
	console.log(`  top ${worst.length} offending names (worst deviation first):`);
	for (const row of worst) {
		console.log(
			`    ${row.name} [${row.category ?? '(no category)'}] — kcal=${row.kcal} ${macroCell(row)} serving=${servingCell(row)} (Atwater ${row.atwaterLower.toFixed(0)}–${row.atwaterUpper.toFixed(0)})`
		);
	}
}

async function main(): Promise<void> {
	const { json, db: dbOverride } = options(process.argv.slice(2));
	const file = dbOverride ?? catalogPath();
	if (!existsSync(file)) {
		console.log(`No catalog file at ${file} — nothing to audit.`);
		return;
	}

	const db = new DatabaseSync(file, { readOnly: true });
	db.exec('pragma query_only = true');
	const rows = readRows(db);
	db.close();

	const groups = groupBySource(rows);
	console.log(
		`Plausibility audit of ${file}: ${rows.length} rows across ${groups.length} sources.`
	);
	for (const group of groups) printGroup(group);

	const totalFailing = groups.reduce((sum, group) => sum + group.failing.length, 0);
	const totalSkipped = groups.reduce((sum, group) => sum + group.skipped, 0);
	console.log(
		`\nOverall: ${totalFailing} failing, ${totalSkipped} skipped, out of ${rows.length}.`
	);

	if (json !== null) {
		await mkdir(path.dirname(json), { recursive: true });
		const payload = groups.map((group) => ({
			source: group.source,
			total: group.total,
			skipped: group.skipped,
			failing: group.failing
		}));
		await writeFile(json, `${JSON.stringify(payload, null, '\t')}\n`);
		console.log(`Full failing list written to ${json}`);
	}
}

await main();

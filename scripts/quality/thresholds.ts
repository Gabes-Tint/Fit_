import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { parseMutationPolicy } from './mutation-types';
import { readJsonFile } from '../security/shared';

/** Fails when a gate threshold moves against its ratchet direction. */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const baselinePath = path.join(projectRoot, 'quality', 'threshold-baseline.json');

/** 'min': the value must never fall. 'max': it must never rise. */
type Direction = 'min' | 'max';

interface Guarded {
	key: string;
	value: number | boolean;
	direction: Direction;
	source: string;
}

function pick(source: Record<string, unknown>, key: string): Record<string, number | boolean> {
	return source[key] as Record<string, number | boolean>;
}

type JsonRecord = Record<string, unknown>;

const thresholds = await readJsonFile<JsonRecord>(
	path.join(projectRoot, 'quality/thresholds.json')
);
const mutationPolicy = parseMutationPolicy(
	await readJsonFile<JsonRecord>(path.join(projectRoot, 'quality/mutation-policy.json'))
);
const budgets = await readJsonFile<JsonRecord>(
	path.join(projectRoot, 'quality/bundle-budgets.json')
);
const duplication = await readJsonFile<JsonRecord>(path.join(projectRoot, '.jscpd.json'));
const suppressions = await readJsonFile<JsonRecord>(
	path.join(projectRoot, 'quality/suppression-baseline.json')
);

const coverage = pick(thresholds, 'coverage');
const mutation = pick(thresholds, 'mutation');
const mutationLimitDirection = (name: string): Direction =>
	name.startsWith('max') ? 'max' : 'min';

const guarded: Guarded[] = [
	...Object.entries(coverage).map(([name, value]): Guarded => ({
		key: `coverage.${name}`,
		value,
		direction: 'min',
		source: 'quality/thresholds.json'
	})),
	...Object.entries(mutation).map(([name, value]): Guarded => ({
		key: `mutation.${name}`,
		value,
		direction: 'min',
		source: 'quality/thresholds.json'
	})),
	...Object.entries(mutationPolicy)
		.filter(([name]) => name !== 'version')
		.flatMap(([policyName, limits]) =>
			Object.entries(limits as Record<string, number>).map(([name, value]): Guarded => ({
				key: `mutationPolicy.${policyName}.${name}`,
				value,
				direction: mutationLimitDirection(name),
				source: 'quality/mutation-policy.json'
			}))
		),
	...Object.entries(budgets).map(([name, value]): Guarded => ({
		key: `bundle.${name}`,
		value: value as number,
		direction: 'max',
		source: 'quality/bundle-budgets.json'
	})),
	{
		key: 'duplication.threshold',
		value: duplication.threshold as number,
		direction: 'max',
		source: '.jscpd.json'
	},
	{
		key: 'duplication.maxClones',
		value: pick(thresholds, 'duplication').maxClones as number,
		direction: 'max',
		source: 'quality/thresholds.json'
	},
	{
		key: 'suppressions.maxUnjustified',
		value: suppressions.maxUnjustified as number,
		direction: 'max',
		source: 'quality/suppression-baseline.json'
	}
];

const current = Object.fromEntries(guarded.map(({ key, value }) => [key, value]));

if (process.argv.includes('--update')) {
	await writeFile(baselinePath, `${JSON.stringify(current, null, '\t')}\n`);
	console.log(`Threshold baseline updated with ${guarded.length} values.`);
	process.exit(0);
}

const baseline = await readJsonFile<Record<string, number | boolean>>(baselinePath);
const weakened: string[] = [];
const missing: string[] = [];

for (const key of Object.keys(baseline)) {
	if (!Object.hasOwn(current, key))
		missing.push(`${key} is recorded but missing from current policy.`);
}

for (const { key, value, direction, source } of guarded) {
	const recorded = baseline[key];
	if (recorded === undefined) {
		missing.push(`${key} is not recorded in the baseline (${source}).`);
		continue;
	}
	if (typeof value === 'boolean' || typeof recorded === 'boolean') {
		if (recorded === true && value !== true) {
			weakened.push(`${key} was disabled (${source}). It was ${String(recorded)}.`);
		}
		continue;
	}
	const isWeaker = direction === 'min' ? value < recorded : value > recorded;
	if (isWeaker) {
		weakened.push(`${key} moved from ${recorded} to ${value} (${source}), weakening the gate.`);
	}
}

console.log(`Thresholds: ${guarded.length} guarded values checked against the baseline.`);

if (weakened.length > 0 || missing.length > 0) {
	for (const message of [...weakened, ...missing]) console.error(`  ${message}`);
	console.error(
		'\nWeakening a threshold is a deliberate, reviewed change, never a way to make a gate pass.'
	);
	console.error('Record a new baseline with: bun run check:thresholds -- --update');
	process.exitCode = 1;
}

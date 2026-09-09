import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { mutationReviewLedgerFailures, sourceWindowHash } from './mutation-verdict';
import type { MutationReviewLedger } from './mutation-types';
import { readJsonFile } from '../security/shared';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = path.join(projectRoot, 'quality', 'mutation-equivalents.json');
const ledger = await readJsonFile<unknown>(ledgerPath);
const failures = mutationReviewLedgerFailures(ledger);
if (failures.length === 0) {
	for (const entry of (ledger as MutationReviewLedger).entries) {
		const source = await readFile(path.join(projectRoot, entry.file), 'utf8');
		const currentHash = sourceWindowHash(source, entry.location);
		if (currentHash !== entry.sourceHash) {
			failures.push(`reviewed mutant source changed: ${entry.file} ${entry.fingerprint}`);
		}
	}
}

if (failures.length === 0) {
	console.log('Mutation review ledger is exact and structurally valid.');
} else {
	for (const failure of failures) console.error(failure);
	process.exitCode = 1;
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_STATE_BODY_BYTES } from '../../src/lib/domain/state-size';
import { templateDirectory } from './config';

/**
 * The transport ceiling and the application ceiling, checked against each other.
 *
 * `adapter-node` reads a request body only up to `BODY_SIZE_LIMIT` and defaults
 * to 512K, which is eight times below what `PUT /api/state` is allowed to
 * carry. Nothing at runtime says so: the endpoint's own ceiling simply becomes
 * unreachable, and every account whose document passes 512K has its sync
 * refused by the transport — with the request stream killed before the
 * application can answer anything a client could read. That is invisible in
 * development, because `vite dev` and `vite preview` do not run the adapter at
 * all, and it is invisible in an end-to-end run for the same reason. So it is
 * checked here, against the two files the deploy installs, which is the only
 * place the disagreement exists (#282).
 */

function template(name: string): string {
	return readFileSync(path.join(templateDirectory, name), 'utf8');
}

/** The value the unit sets for a name, or `null` when it sets none. */
function unitEnvironment(name: string): string | null {
	const found = template('fit.service')
		.split('\n')
		.map((line) => new RegExp(`^Environment=${name}=(.*)$`).exec(line.trim())?.[1])
		.filter((value): value is string => value !== undefined);
	expect(found.length, `${name} is set at most once in fit.service`).toBeLessThan(2);
	return found[0] ?? null;
}

describe('the request body ceiling on the machine', () => {
	it('lets through exactly what the state endpoint is willing to read', () => {
		expect(Number(unitEnvironment('BODY_SIZE_LIMIT'))).toBe(MAX_STATE_BODY_BYTES);
	});

	it('is set by the unit, which every release installs', () => {
		// The environment file is written only when it is absent, so a machine
		// that already exists would never see a value added there.
		expect(unitEnvironment('BODY_SIZE_LIMIT')).not.toBeNull();
	});

	it('is not also set in the environment file, which would override the unit', () => {
		// systemd applies EnvironmentFile= after Environment=, so a line there
		// wins — on the one file the deploy leaves alone.
		expect(template('fit.env.example')).not.toMatch(/^\s*BODY_SIZE_LIMIT=/m);
	});
});

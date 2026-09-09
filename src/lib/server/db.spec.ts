import type * as NodeFs from 'node:fs';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationDatabasePath, getDatabase, migrate, openDatabase } from './db';

// `statSync` is wrapped so one test can force an insecure stat result without
// disturbing every other test's real filesystem assertions: the wrapped
// implementation delegates to the actual `statSync` unless a test overrides
// it with `mockImplementation`.
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof NodeFs>();
	return { ...actual, statSync: vi.fn(actual.statSync) };
});

// Captured once, so a test that overrides `statSync` can restore the real
// implementation afterwards instead of leaving a mocked return value in
// place for whichever test happens to call `statSync` next.
const capturedRealStatSync = vi.mocked(statSync).getMockImplementation();
if (capturedRealStatSync === undefined) {
	throw new Error('expected the node:fs mock factory to seed a default statSync implementation');
}
const realStatSync = capturedRealStatSync;

const temporaryDirectories: string[] = [];

function temporaryPath(name: string) {
	const directory = mkdtempSync(join(tmpdir(), 'fit-db-'));
	temporaryDirectories.push(directory);
	return join(directory, name);
}

function tableNames(db: DatabaseSync) {
	return db
		.prepare("select name from sqlite_master where type = 'table' order by name")
		.all()
		.map((row) => row['name']);
}

function userVersion(db: DatabaseSync) {
	return db.prepare('pragma user_version').get()?.['user_version'];
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('migrate', () => {
	it('creates every table the users module needs', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(tableNames(db)).toEqual(
			expect.arrayContaining(['account', 'household', 'membership', 'profile', 'session'])
		);
	});

	it('creates the sign-in throttle the authentication layer counts in', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(tableNames(db)).toContain('sign_in_throttle');
	});

	it('counts registration attempts in the throttle table beside sign-in failures', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(() => {
			db.exec(
				`insert into sign_in_throttle (scope, key_hash, failures, window_ends_at)
				 values ('registration', 'deadbeef', 1, '2026-09-01T00:00:00.000Z')`
			);
		}).not.toThrow();
	});

	it('still refuses a scope nothing counts in', () => {
		// The check constraint is what stops a scope typo from becoming a dead counter.
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(() => {
			db.exec(
				`insert into sign_in_throttle (scope, key_hash, failures, window_ends_at)
				 values ('reg', 'deadbeef', 1, '2026-09-01T00:00:00.000Z')`
			);
		}).toThrow();
	});

	it('carries the counts across the table it rebuilt them in', () => {
		// Widening the check constraint must not drop existing lockouts.
		const db = new DatabaseSync(':memory:');
		db.exec(
			`create table sign_in_throttle (
				scope          text not null check (scope in ('username', 'address')),
				key_hash       text not null,
				failures       integer not null,
				window_ends_at text not null,
				locked_until   text,
				primary key (scope, key_hash)
			) strict;
			create index sign_in_throttle_expiry on sign_in_throttle (window_ends_at);
			insert into sign_in_throttle (scope, key_hash, failures, window_ends_at, locked_until)
			values ('username', 'deadbeef', 6, '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z');
			pragma user_version = 2`
		);
		migrate(db);
		expect(db.prepare('select * from sign_in_throttle').all()).toEqual([
			{
				scope: 'username',
				key_hash: 'deadbeef',
				failures: 6,
				window_ends_at: '2026-09-01T00:00:00.000Z',
				locked_until: '2026-09-01T00:01:00.000Z'
			}
		]);
	});

	it('creates the household state table the sync endpoints store into', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(tableNames(db)).toContain('household_state');
	});

	it('creates the photo quota table the spend guard counts in', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(tableNames(db)).toContain('photo_quota');
	});

	it('refuses a photo quota row filed under a scope nothing counts', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(() =>
			db
				.prepare('insert into photo_quota (scope, holder, day, calls) values (?, ?, ?, ?)')
				.run('household', 'h1', '2026-09-04', 1)
		).toThrow();
	});

	it('cascades household deletion onto its stored state document', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			stamp
		);
		db.prepare(
			`insert into account (id, username, display_name, password_hash, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?)`
		).run('a1', 'jordan', 'Jordan', 'hash', stamp, stamp);
		db.prepare(
			`insert into household_state (household_id, format, body, version, updated_at, updated_by)
			 values (?, ?, ?, ?, ?, ?)`
		).run('h1', 'tend.v1', '{}', 1, stamp, 'a1');

		db.prepare('delete from household where id = ?').run('h1');
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
	});

	it('leaves the expiry index in place after that rebuild', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		const indexes = db
			.prepare("select name from sqlite_master where type = 'index'")
			.all()
			.map((row) => row['name']);
		expect(indexes).toContain('sign_in_throttle_expiry');
	});

	it('brings an older database forward without re-running what it has', () => {
		const db = new DatabaseSync(':memory:');
		db.exec('pragma user_version = 1');
		// Only migrations after version 1 may run; re-applying one fails on `create table`.
		expect(() => migrate(db)).not.toThrow();
		expect(tableNames(db)).toContain('sign_in_throttle');
		expect(tableNames(db)).not.toContain('account');
	});

	it('records the applied version in the database itself', () => {
		const db = new DatabaseSync(':memory:');
		expect(migrate(db)).toBe(userVersion(db));
	});

	it('is a no-op on a database that is already current', () => {
		const db = new DatabaseSync(':memory:');
		const first = migrate(db);
		// A second run that re-applied migration 1 would fail on `create table`.
		expect(migrate(db)).toBe(first);
	});

	it('refuses a database from a newer server rather than guessing at its schema', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		db.exec('pragma user_version = 99');
		expect(() => migrate(db)).toThrow('newer than this server supports');
	});

	it('rolls back a migration that cannot be applied', () => {
		const db = new DatabaseSync(':memory:');
		db.exec('create table account (id text primary key) strict');
		expect(() => migrate(db)).toThrow();
		expect(tableNames(db)).not.toContain('household');
		expect(userVersion(db)).toBe(0);
		expect(() => {
			db.exec('begin');
			db.exec('rollback');
		}).not.toThrow();
	});
});

describe('openDatabase', () => {
	it('does not create a filesystem artifact for an in-memory database', () => {
		expect(existsSync(':memory:')).toBe(false);
		const db = openDatabase(':memory:');
		expect(existsSync(':memory:')).toBe(false);
		db.close();
	});

	it.skipIf(process.platform === 'win32')(
		'does not treat a file named like the in-memory sentinel as database storage',
		() => {
			writeFileSync(':memory:', 'unrelated');
			chmodSync(':memory:', 0o666);
			try {
				const db = openDatabase(':memory:');
				expect(statSync(':memory:').mode & 0o777).toBe(0o666);
				db.close();
			} finally {
				rmSync(':memory:', { force: true });
			}
		}
	);

	it('creates the directory the database file lives in', () => {
		const path = temporaryPath('nested/deeper/app.sqlite');
		const db = openDatabase(path);
		expect(tableNames(db)).toContain('account');
		db.close();
	});

	it.skipIf(process.platform === 'win32')(
		'keeps the database directory, file, and live SQLite sidecars private',
		() => {
			const path = temporaryPath('private/app.sqlite');
			const directory = dirname(path);
			const db = openDatabase(path);
			db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
				'h1',
				'Home',
				'2026-08-29T00:00:00.000Z'
			);

			expect(statSync(directory).mode & 0o777).toBe(0o700);
			expect(statSync(path).mode & 0o777).toBe(0o600);
			for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
				expect(existsSync(sidecar)).toBe(true);
				expect(statSync(sidecar).mode & 0o777).toBe(0o600);
			}
			db.close();
		}
	);

	it.skipIf(process.platform !== 'linux')('does not leak the file-hardening descriptor', () => {
		const path = temporaryPath('descriptor/app.sqlite');
		const db = openDatabase(path);
		const descriptors = readdirSync('/proc/self/fd').filter((descriptor) => {
			try {
				return readlinkSync(`/proc/self/fd/${descriptor}`) === path;
			} catch {
				return false;
			}
		});
		expect(descriptors).toHaveLength(1);
		db.close();
	});

	it.skipIf(process.platform === 'win32')(
		'refuses an existing public directory without changing its permissions',
		() => {
			const path = temporaryPath('app.sqlite');
			const directory = dirname(path);
			chmodSync(directory, 0o755);
			expect(() => openDatabase(path)).toThrow('database directory must be private');
			expect(statSync(directory).mode & 0o777).toBe(0o755);
		}
	);

	it.skipIf(process.platform === 'win32')(
		'does not require privacy from a directory it just created',
		() => {
			// The mode passed to mkdirSync already makes a fresh directory private
			// (0700), so this forces statSync to lie about it: only the
			// `created === undefined` guard, not the real mode, can be why this
			// does not throw.
			const path = temporaryPath('brand-new/nested/app.sqlite');
			vi.mocked(statSync).mockImplementation(
				() => ({ mode: 0o777 }) as ReturnType<typeof statSync>
			);
			try {
				expect(() => openDatabase(path)).not.toThrow();
			} finally {
				vi.mocked(statSync).mockImplementation(realStatSync);
			}
		}
	);

	it('does not require directory privacy on a platform without POSIX modes', () => {
		const path = temporaryPath('app.sqlite');
		const directory = dirname(path);
		chmodSync(directory, 0o755);
		const originalPlatform = process.platform;
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		try {
			expect(() => openDatabase(path)).not.toThrow();
		} finally {
			Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'hardens existing sidecars and closes a connection when migration fails',
		() => {
			const path = temporaryPath('app.sqlite');
			const raw = new DatabaseSync(path);
			raw.exec('pragma journal_mode = wal');
			raw.exec('create table future_data (value text) strict');
			raw.exec('pragma user_version = 99');
			for (const candidate of [path, `${path}-wal`, `${path}-shm`]) chmodSync(candidate, 0o666);
			const close = vi.spyOn(DatabaseSync.prototype, 'close');

			expect(() => openDatabase(path)).toThrow('newer than this server supports');
			expect(close).toHaveBeenCalledTimes(1);
			for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
				expect(statSync(candidate).mode & 0o777).toBe(0o600);
			}
			close.mockRestore();
			raw.close();
		}
	);

	it.skipIf(process.platform === 'win32')(
		'hardens existing credential files before opening SQLite',
		() => {
			const path = temporaryPath('app.sqlite');
			const directory = dirname(path);
			const setup = new DatabaseSync(path);
			setup.close();
			for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
				if (!existsSync(candidate)) writeFileSync(candidate, 'pending recovery data');
				chmodSync(candidate, 0o666);
			}
			const openingFailure = new Error('opening stopped after permission inspection');

			expect(() =>
				openDatabase(path, () => {
					expect(statSync(directory).mode & 0o777).toBe(0o700);
					for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
						expect(statSync(candidate).mode & 0o777).toBe(0o600);
					}
					throw openingFailure;
				})
			).toThrow(openingFailure);
		}
	);

	it.skipIf(process.platform === 'win32')(
		'hardens sidecars created during a failed database open',
		() => {
			const path = temporaryPath('failed-open/app.sqlite');
			const openingFailure = new Error('database setup failed');
			const close = vi.fn();
			const fake = {
				exec: () => {
					throw openingFailure;
				},
				close
			} as unknown as DatabaseSync;

			expect(() =>
				openDatabase(path, () => {
					for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
						writeFileSync(sidecar, 'pending recovery data');
						chmodSync(sidecar, 0o666);
					}
					return fake;
				})
			).toThrow(openingFailure);
			expect(close).toHaveBeenCalledOnce();
			for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
				expect(statSync(sidecar).mode & 0o777).toBe(0o600);
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'hardens sidecars when the database constructor itself fails',
		() => {
			const path = temporaryPath('constructor-fails/app.sqlite');
			const openingFailure = new Error('database constructor failed');

			expect(() =>
				openDatabase(path, () => {
					for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
						writeFileSync(sidecar, 'pending recovery data');
						chmodSync(sidecar, 0o666);
					}
					throw openingFailure;
				})
			).toThrow(openingFailure);
			for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
				expect(statSync(sidecar).mode & 0o777).toBe(0o600);
			}
		}
	);

	it('enforces foreign keys, which SQLite leaves off by default', () => {
		const db = openDatabase(':memory:');
		expect(() =>
			db
				.prepare(
					'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
				)
				.run('no-such-household', 'no-such-account', 'owner', '2026-08-29T00:00:00.000Z')
		).toThrow();
	});

	it('configures WAL journal mode and the write-lock wait on file databases', () => {
		const path = temporaryPath('configured/app.sqlite');
		const db = openDatabase(path);
		expect(db.prepare('pragma journal_mode').get()?.['journal_mode']).toBe('wal');
		expect(db.prepare('pragma busy_timeout').get()?.['timeout']).toBe(5000);
		db.close();
	});

	it.skipIf(process.platform === 'win32')(
		'preserves the migration error if closing the failed connection also fails',
		() => {
			const path = temporaryPath('app.sqlite');
			const raw = new DatabaseSync(path);
			raw.exec('pragma user_version = 99');
			raw.close();
			const close = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementationOnce(() => {
				throw new Error('close failed');
			});

			try {
				expect(() => openDatabase(path)).toThrow('newer than this server supports');
			} finally {
				close.mockRestore();
			}
		}
	);

	it('rejects a membership role outside the two the schema allows', () => {
		const db = openDatabase(':memory:');
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			'2026-08-29T00:00:00.000Z'
		);
		db.prepare(
			`insert into account (id, username, display_name, password_hash, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?)`
		).run('a1', 'jordan', 'Jordan', 'x', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z');
		expect(() =>
			db
				.prepare(
					'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
				)
				.run('h1', 'a1', 'administrator', '2026-08-29T00:00:00.000Z')
		).toThrow();
	});

	it('rejects linking an account to a profile outside its household membership', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		for (const [householdId, accountId, username] of [
			['h1', 'a1', 'jordan'] as const,
			['h2', 'a2', 'alex'] as const
		]) {
			db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
				householdId,
				`${username} home`,
				stamp
			);
			db.prepare(
				`insert into account (id, username, display_name, password_hash, created_at, updated_at)
				 values (?, ?, ?, ?, ?, ?)`
			).run(accountId, username, username, 'hash', stamp, stamp);
			db.prepare(
				'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
			).run(householdId, accountId, 'owner', stamp);
		}

		expect(() =>
			db
				.prepare(
					'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
				)
				.run('p1', 'h1', 'a2', 'Alex', stamp)
		).toThrow();
	});

	it('allows a profile without an account in its household', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			stamp
		);
		db.prepare(
			'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
		).run('p1', 'h1', null, 'Child', stamp);
		expect(
			db.prepare('select account_id from profile where id = ?').get('p1')?.['account_id']
		).toBeNull();
	});

	it('keeps a profile but unlinks its account when that account is deleted', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			stamp
		);
		db.prepare(
			`insert into account (id, username, display_name, password_hash, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?)`
		).run('a1', 'jordan', 'Jordan', 'hash', stamp, stamp);
		db.prepare(
			'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
		).run('h1', 'a1', 'owner', stamp);
		db.prepare(
			'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
		).run('p1', 'h1', 'a1', 'Jordan', stamp);

		db.prepare('delete from account where id = ?').run('a1');
		expect(
			db.prepare('select account_id from profile where id = ?').get('p1')?.['account_id']
		).toBeNull();
	});

	it('allows only one signed-in profile per membership', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			stamp
		);
		db.prepare(
			`insert into account (id, username, display_name, password_hash, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?)`
		).run('a1', 'jordan', 'Jordan', 'hash', stamp, stamp);
		db.prepare(
			'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
		).run('h1', 'a1', 'owner', stamp);
		db.prepare(
			'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
		).run('p1', 'h1', 'a1', 'Jordan', stamp);

		expect(() =>
			db
				.prepare(
					'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
				)
				.run('p2', 'h1', 'a1', 'Jordan again', stamp)
		).toThrow();
	});

	it('preserves and unlinks a profile when its membership is removed', () => {
		const db = openDatabase(':memory:');
		const stamp = '2026-08-29T00:00:00.000Z';
		db.prepare('insert into household (id, name, created_at) values (?, ?, ?)').run(
			'h1',
			'Home',
			stamp
		);
		db.prepare(
			`insert into account (id, username, display_name, password_hash, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?)`
		).run('a1', 'jordan', 'Jordan', 'hash', stamp, stamp);
		db.prepare(
			'insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)'
		).run('h1', 'a1', 'owner', stamp);
		db.prepare(
			'insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)'
		).run('p1', 'h1', 'a1', 'Jordan', stamp);

		db.prepare('delete from membership where household_id = ? and account_id = ?').run('h1', 'a1');
		expect(
			db.prepare('select household_id, account_id from profile where id = ?').get('p1')
		).toEqual({ household_id: 'h1', account_id: null });
	});
});

describe('getDatabase', () => {
	it('resolves the configured path or the private runtime default', () => {
		expect(applicationDatabasePath('/srv/fit/app.sqlite')).toBe('/srv/fit/app.sqlite');
		expect(applicationDatabasePath(undefined)).toBe('data/runtime/app.sqlite');
		const previousPath = process.env['FIT_DB_PATH'];
		process.env['FIT_DB_PATH'] = '/srv/fit/from-environment.sqlite';
		try {
			expect(applicationDatabasePath()).toBe('/srv/fit/from-environment.sqlite');
		} finally {
			if (previousPath === undefined) delete process.env['FIT_DB_PATH'];
			else process.env['FIT_DB_PATH'] = previousPath;
		}
	});

	it('owns one lazily opened application connection', () => {
		const path = temporaryPath('runtime/app.sqlite');
		const previousPath = process.env['FIT_DB_PATH'];
		process.env['FIT_DB_PATH'] = path;
		try {
			const first = getDatabase();
			expect(getDatabase()).toBe(first);
			expect(tableNames(first)).toContain('account');
			first.close();
		} finally {
			if (previousPath === undefined) delete process.env['FIT_DB_PATH'];
			else process.env['FIT_DB_PATH'] = previousPath;
		}
	});
});

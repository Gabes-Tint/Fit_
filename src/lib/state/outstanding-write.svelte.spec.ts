import { describe, expect, it } from 'vitest';
import { fingerprint, isOwnWrite, outstandingWriteIn, pendingWrite } from './outstanding-write';

const SENT = { onboarded: true, profiles: [{ name: 'Alex', heightCm: 168 }] };
const SENT_FINGERPRINT = fingerprint(SENT);

/** What a document looks like once it has been to the server and back. */
function roundTripped(body: object): object {
	return JSON.parse(JSON.stringify(body)) as object;
}

describe('naming a document', () => {
	/**
	 * The names are pinned, not merely compared to each other. A fingerprint is
	 * written to the device before a write leaves and read back after a reload,
	 * so what it must be is *this* value and not just some stable value: a
	 * comparison against itself would pass with any constant in the hash, and
	 * would say nothing about two documents that are not the same.
	 */
	it('is the same name every time, for these documents', () => {
		expect(fingerprint({})).toBe('2.1415952421');
		expect(fingerprint({ onboarded: true, profiles: [{ name: 'Alex', heightCm: 168 }] })).toBe(
			'62.463931322'
		);
		expect(fingerprint({ onboarded: true, profiles: [{ name: 'Alex', heightCm: 175.26 }] })).toBe(
			'65.3329886572'
		);
	});

	it('survives the trip to the server and back', () => {
		expect(fingerprint(roundTripped(SENT))).toBe(SENT_FINGERPRINT);
	});

	it('changes when the smallest thing in the document does', () => {
		const oneDigit = { onboarded: true, profiles: [{ name: 'Alex', heightCm: 169 }] };
		expect(fingerprint(oneDigit)).not.toBe(SENT_FINGERPRINT);
	});

	it('tells apart two documents of the same length', () => {
		expect(fingerprint({ a: 'xy' })).not.toBe(fingerprint({ a: 'yx' }));
	});
});

describe('reading the outstanding writes off a stored record', () => {
	it('is none for a record that names none', () => {
		expect(outstandingWriteIn(undefined)).toBeNull();
		expect(outstandingWriteIn(null)).toBeNull();
		expect(outstandingWriteIn({})).toBeNull();
	});

	it('is none when either half is missing or the wrong kind of thing', () => {
		expect(outstandingWriteIn({ version: 3 })).toBeNull();
		expect(outstandingWriteIn({ fingerprints: ['abc'] })).toBeNull();
		expect(outstandingWriteIn({ version: '3', fingerprints: ['abc'] })).toBeNull();
		expect(outstandingWriteIn({ version: 1.5, fingerprints: ['abc'] })).toBeNull();
		expect(outstandingWriteIn({ version: 3, fingerprints: 'abc' })).toBeNull();
		expect(outstandingWriteIn({ version: 3, fingerprints: [] })).toBeNull();
	});

	/**
	 * One bad entry answers "no" for the whole record rather than being quietly
	 * dropped: a list with a hole in it cannot say which write is missing from
	 * it, and a device that adopts on "no" is the behavior this module improves
	 * on rather than one it can get wrong.
	 */
	it('is none when any of the names is not a name', () => {
		expect(outstandingWriteIn({ version: 3, fingerprints: ['abc', 7] })).toBeNull();
		expect(outstandingWriteIn({ version: 3, fingerprints: [null] })).toBeNull();
	});

	it('is the writes when both halves are there', () => {
		expect(outstandingWriteIn({ version: 3, fingerprints: ['abc', 'def'] })).toEqual({
			version: 3,
			fingerprints: ['abc', 'def']
		});
	});

	/**
	 * A record left by the build that kept one write. Reading it as the list of
	 * one it is means a device does not lose the protection it was already
	 * holding the moment it updates — which is exactly the moment a write is
	 * most likely to be in the air unanswered.
	 */
	it('reads a record from the build that named a single write', () => {
		expect(outstandingWriteIn({ version: 3, fingerprint: 'abc' })).toEqual({
			version: 3,
			fingerprints: ['abc']
		});
		expect(outstandingWriteIn({ version: 3, fingerprint: 7 })).toBeNull();
	});
});

describe('adding a write to the ones still unanswered', () => {
	it('is the first name on its own when nothing was outstanding', () => {
		expect(pendingWrite(null, 4, 'abc')).toEqual({ version: 4, fingerprints: ['abc'] });
	});

	it('keeps the earlier name beside the new one, oldest first', () => {
		const first = pendingWrite(null, 4, 'abc');
		expect(pendingWrite(first, 4, 'def')).toEqual({ version: 4, fingerprints: ['abc', 'def'] });
	});

	/**
	 * The retry clock sends the same document again when nothing has changed
	 * since. Counting that twice would fill the list with one document's name.
	 */
	it('adds nothing for a document already named', () => {
		const first = pendingWrite(null, 4, 'abc');
		expect(pendingWrite(first, 4, 'abc')).toEqual({ version: 4, fingerprints: ['abc'] });
	});

	/**
	 * A version that moved is a version whose writes were all answered — the
	 * answer is what moved it — so nothing from it is outstanding any more.
	 */
	it('starts over at a version the earlier names are not about', () => {
		const first = pendingWrite(null, 4, 'abc');
		expect(pendingWrite(first, 5, 'def')).toEqual({ version: 5, fingerprints: ['def'] });
		expect(pendingWrite(first, 3, 'def')).toEqual({ version: 3, fingerprints: ['def'] });
	});

	it('stops growing, keeping the oldest names rather than the newest', () => {
		let write = pendingWrite(null, 4, 'name-0');
		for (let index = 1; index < 40; index += 1) write = pendingWrite(write, 4, `name-${index}`);

		expect(write.fingerprints).toHaveLength(16);
		expect(write.fingerprints[0]).toBe('name-0');
		expect(write.fingerprints.at(-1)).toBe('name-15');
	});
});

describe('recognizing this device’s own unanswered write', () => {
	const outstanding = { version: 4, fingerprints: [SENT_FINGERPRINT] };

	it('is the server holding what that write carried, one version on', () => {
		expect(isOwnWrite(outstanding, 5, roundTripped(SENT))).toBe(true);
	});

	it('is not so when this device has no unanswered write', () => {
		expect(isOwnWrite(null, 5, roundTripped(SENT))).toBe(false);
	});

	/**
	 * The version the write was sent from is the version it did *not* create, and
	 * two versions on is somebody else having written after it — neither is a
	 * document this device may assume is its own.
	 */
	it('is not so at any version but the one that write would have created', () => {
		expect(isOwnWrite(outstanding, 4, roundTripped(SENT))).toBe(false);
		expect(isOwnWrite(outstanding, 6, roundTripped(SENT))).toBe(false);
		expect(isOwnWrite(outstanding, 3, roundTripped(SENT))).toBe(false);
	});

	/**
	 * The case that decides whether another device's work is safe: it wrote at the
	 * same moment, so it landed on exactly the version this device's write would
	 * have. Only what the document holds tells the two apart.
	 */
	it('is not so when the version is right but another device wrote it', () => {
		const theirs = { onboarded: true, profiles: [{ name: 'Jordan', heightCm: 168 }] };
		expect(isOwnWrite(outstanding, 5, theirs)).toBe(false);
	});

	/**
	 * The one the earlier build could not answer. Two writes went out from the
	 * same version because the first was never answered; the first is the one
	 * that landed, and it is not the last thing this device sent.
	 */
	it('is so for an earlier unanswered write, not only the most recent', () => {
		const earlier = { version: 4, fingerprints: [SENT_FINGERPRINT, 'a-later-document'] };
		expect(isOwnWrite(earlier, 5, roundTripped(SENT))).toBe(true);
	});
});

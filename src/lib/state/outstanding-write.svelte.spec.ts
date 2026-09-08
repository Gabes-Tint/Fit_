import { describe, expect, it } from 'vitest';
import { fingerprint, isOwnWrite, outstandingWriteIn } from './outstanding-write';

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

describe('reading the outstanding write off a stored record', () => {
	it('is none for a record that names none', () => {
		expect(outstandingWriteIn(undefined)).toBeNull();
		expect(outstandingWriteIn(null)).toBeNull();
		expect(outstandingWriteIn({})).toBeNull();
	});

	it('is none when either half is missing or the wrong kind of thing', () => {
		expect(outstandingWriteIn({ version: 3 })).toBeNull();
		expect(outstandingWriteIn({ fingerprint: 'abc' })).toBeNull();
		expect(outstandingWriteIn({ version: '3', fingerprint: 'abc' })).toBeNull();
		expect(outstandingWriteIn({ version: 1.5, fingerprint: 'abc' })).toBeNull();
		expect(outstandingWriteIn({ version: 3, fingerprint: 7 })).toBeNull();
	});

	it('is the write when both halves are there', () => {
		expect(outstandingWriteIn({ version: 3, fingerprint: 'abc' })).toEqual({
			version: 3,
			fingerprint: 'abc'
		});
	});
});

describe('recognizing this device’s own unanswered write', () => {
	const outstanding = { version: 4, fingerprint: SENT_FINGERPRINT };

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
});

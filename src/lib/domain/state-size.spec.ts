import { describe, expect, it } from 'vitest';
import { refusedForSize, refusedSize, TOO_LARGE_REASON, worthSending } from './state-size';

describe('refusedForSize', () => {
	it('recognises the refusal the state endpoint answers an oversized document with', () => {
		expect(refusedForSize({ error: { code: 'invalid-body', reason: TOO_LARGE_REASON } })).toBe(
			true
		);
	});

	it('does not read a plain malformed-body refusal as a size refusal', () => {
		// The two share a code on the wire, and only one of them is worth
		// telling somebody about.
		expect(refusedForSize({ error: { code: 'invalid-body' } })).toBe(false);
	});

	it('does not read the same reason under another code as this endpoint speaking', () => {
		expect(refusedForSize({ error: { code: 'invalid-input', reason: TOO_LARGE_REASON } })).toBe(
			false
		);
	});

	it.each([
		['nothing at all', undefined],
		['a null answer', null],
		['an answer that is not an object', 'too-large'],
		['an answer carrying no error', {}],
		['an error that is null', { error: null }],
		['an error that is a bare string', { error: TOO_LARGE_REASON }]
	])('answers no for %s', (_label, answer) => {
		expect(refusedForSize(answer)).toBe(false);
	});
});

describe('worthSending', () => {
	it('offers a document when the server has never refused one for its size', () => {
		expect(worthSending(null, 4_000_000)).toBe(true);
	});

	it('does not offer a document the size of one already refused', () => {
		// The document only grows, so re-sending the same size is a megabytes-long
		// upload whose answer is already known.
		expect(worthSending(100, 100)).toBe(false);
	});

	it('does not offer a document larger than the one refused', () => {
		expect(worthSending(100, 101)).toBe(false);
	});

	it('offers a document that has since shrunk, which is how a device recovers', () => {
		expect(worthSending(100, 99)).toBe(true);
	});
});

describe('refusedSize', () => {
	it('remembers the size of the first refusal', () => {
		expect(refusedSize(null, 5)).toBe(5);
	});

	it('takes the tighter bound when a smaller document is refused too', () => {
		expect(refusedSize(9, 5)).toBe(5);
	});

	it('keeps the bound it has when a larger document is refused', () => {
		expect(refusedSize(5, 9)).toBe(5);
	});
});

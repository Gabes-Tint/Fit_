import { describe, expect, it } from 'vitest';
import { validateCheckpointKey } from './checkpoint-key';

describe('checkpoint-key validator', () => {
	it('accepts lowercase letters, digits, and hyphens', () => {
		expect(validateCheckpointKey('valid-key-123')).toEqual({ ok: true, value: 'valid-key-123' });
		expect(validateCheckpointKey('a')).toEqual({ ok: true, value: 'a' });
		expect(validateCheckpointKey('z')).toEqual({ ok: true, value: 'z' });
		expect(validateCheckpointKey('checkout')).toEqual({ ok: true, value: 'checkout' });
		expect(validateCheckpointKey('my-workflow-v2')).toEqual({
			ok: true,
			value: 'my-workflow-v2'
		});
		expect(validateCheckpointKey('step-1-resume')).toEqual({ ok: true, value: 'step-1-resume' });
	});

	it('accepts zero as a digit in the key', () => {
		expect(validateCheckpointKey('step0')).toEqual({ ok: true, value: 'step0' });
		expect(validateCheckpointKey('v0-checkpoint')).toEqual({ ok: true, value: 'v0-checkpoint' });
	});

	it('rejects empty values', () => {
		const result = validateCheckpointKey('');
		expect(result).toHaveProperty('ok', false);
		expect(result).toHaveProperty('reason');
	});

	it('rejects whitespace', () => {
		expect(validateCheckpointKey(' key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key ')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('my key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('\t')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('\n')).toMatchObject({ ok: false });
	});

	it('rejects uppercase letters', () => {
		expect(validateCheckpointKey('MyKey')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('CONSTANT')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('A')).toMatchObject({ ok: false });
	});

	it('rejects forward slashes', () => {
		expect(validateCheckpointKey('path/to/key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('/key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key/')).toMatchObject({ ok: false });
	});

	it('rejects backslashes', () => {
		expect(validateCheckpointKey('path\\to\\key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('\\key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key\\')).toMatchObject({ ok: false });
	});

	it('rejects leading digits', () => {
		expect(validateCheckpointKey('1-start')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('0key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('9-test')).toMatchObject({ ok: false });
	});

	it('rejects a single dot', () => {
		expect(validateCheckpointKey('.')).toMatchObject({ ok: false });
	});

	it('rejects a double dot', () => {
		expect(validateCheckpointKey('..')).toMatchObject({ ok: false });
	});

	it('rejects dots in traversal-like positions', () => {
		expect(validateCheckpointKey('./key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key/.')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('../key')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key/..')).toMatchObject({ ok: false });
	});

	it('rejects special characters', () => {
		expect(validateCheckpointKey('key@value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key#1')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key$money')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key%test')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key&value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key*')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key(test)')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key=value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key+value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key[0]')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key{name}')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key;value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key:value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key,value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key.value')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key?query')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key!bang')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key~tilde')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key`backtick')).toMatchObject({ ok: false });
		expect(validateCheckpointKey('key|pipe')).toMatchObject({ ok: false });
	});

	it('accepts hyphens at the beginning, middle, and end (except leading digit rule)', () => {
		expect(validateCheckpointKey('-key')).toEqual({ ok: true, value: '-key' });
		expect(validateCheckpointKey('key-middle')).toEqual({ ok: true, value: 'key-middle' });
		expect(validateCheckpointKey('key-')).toEqual({ ok: true, value: 'key-' });
	});

	it('returns a typed result that narrows on ok property', () => {
		const result = validateCheckpointKey('valid-key');
		expect(result).toMatchObject({ ok: true, value: 'valid-key' });
	});

	it('includes reason in failure result', () => {
		const result = validateCheckpointKey('!invalid');
		expect(result).toHaveProperty('reason');
		expect(result.reason).toBeDefined();
	});

	it('prevents invalid keys from being treated as valid through type narrowing', () => {
		const invalidResult = validateCheckpointKey('invalid key');
		expect(invalidResult).toHaveProperty('reason');
		expect(invalidResult.reason).toBeDefined();
	});
});

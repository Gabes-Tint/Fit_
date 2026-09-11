import { describe, expect, it } from 'vitest';

describe('checkpoint-key validator', () => {
	it('accepts lowercase letters, digits, and hyphens', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('valid-key-123')).toEqual({
			ok: true,
			value: 'valid-key-123'
		});
		expect(mod.validateCheckpointKey('a')).toEqual({ ok: true, value: 'a' });
		expect(mod.validateCheckpointKey('z')).toEqual({ ok: true, value: 'z' });
		expect(mod.validateCheckpointKey('checkout')).toEqual({ ok: true, value: 'checkout' });
		expect(mod.validateCheckpointKey('my-workflow-v2')).toEqual({
			ok: true,
			value: 'my-workflow-v2'
		});
		expect(mod.validateCheckpointKey('step-1-resume')).toEqual({
			ok: true,
			value: 'step-1-resume'
		});
	});

	it('accepts zero as a digit in the key', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('step0')).toEqual({ ok: true, value: 'step0' });
		expect(mod.validateCheckpointKey('v0-checkpoint')).toEqual({
			ok: true,
			value: 'v0-checkpoint'
		});
	});

	it('rejects empty values', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		const result = mod.validateCheckpointKey('');
		expect(result).toHaveProperty('ok', false);
		expect(result).toHaveProperty('reason');
	});

	it('rejects whitespace', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey(' key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key ')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('my key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('\t')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('\n')).toMatchObject({ ok: false });
	});

	it('rejects uppercase letters', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('MyKey')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('CONSTANT')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('A')).toMatchObject({ ok: false });
	});

	it('rejects forward slashes', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('path/to/key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('/key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key/')).toMatchObject({ ok: false });
	});

	it('rejects backslashes', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('path\\to\\key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('\\key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key\\')).toMatchObject({ ok: false });
	});

	it('rejects leading digits', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('1-start')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('0key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('9-test')).toMatchObject({ ok: false });
	});

	it('rejects a single dot', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('.')).toMatchObject({ ok: false });
	});

	it('rejects a double dot', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('..')).toMatchObject({ ok: false });
	});

	it('rejects dots in traversal-like positions', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('./key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key/.')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('../key')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key/..')).toMatchObject({ ok: false });
	});

	it('rejects special characters', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('key@value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key#1')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key$money')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key%test')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key&value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key*')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key(test)')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key=value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key+value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key[0]')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key{name}')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key;value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key:value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key,value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key.value')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key?query')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key!bang')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key~tilde')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key`backtick')).toMatchObject({ ok: false });
		expect(mod.validateCheckpointKey('key|pipe')).toMatchObject({ ok: false });
	});

	it('accepts hyphens at the beginning, middle, and end (except leading digit rule)', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		expect(mod.validateCheckpointKey('-key')).toEqual({ ok: true, value: '-key' });
		expect(mod.validateCheckpointKey('key-middle')).toEqual({ ok: true, value: 'key-middle' });
		expect(mod.validateCheckpointKey('key-')).toEqual({ ok: true, value: 'key-' });
	});

	it('returns a typed result that narrows on ok property', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		const result = mod.validateCheckpointKey('valid-key');
		expect(result).toMatchObject({ ok: true, value: 'valid-key' });
	});

	it('includes reason in failure result', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		const result = mod.validateCheckpointKey('!invalid');
		expect(result).toHaveProperty('reason');
	});

	it('prevents invalid keys from being treated as valid through type narrowing', async () => {
		const mod = (await import('./checkpoint-key')) as {
			validateCheckpointKey: (key: string) => { ok: boolean; value?: string; reason?: string };
		};
		const result = mod.validateCheckpointKey('invalid key');
		expect(result).toHaveProperty('reason');
	});
});

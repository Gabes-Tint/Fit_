export type CheckpointKeyResult = { ok: true; value: string } | { ok: false; reason: string };

export function validateCheckpointKey(key: string): CheckpointKeyResult {
	void key;
	throw new Error('Not implemented');
}

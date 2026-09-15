<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { OUTCOMES } from '../graph';
	import type { TerminalNodeType } from '../layout';
	import Handles from './Handles.svelte';

	let { data, selected }: NodeProps<TerminalNodeType> = $props();

	const exits = $derived(
		[...new Set((data.node.outcomes ?? []).map((name) => OUTCOMES[name]))].join('/')
	);
</script>

<Handles />
<div
	class="terminal tone-{data.node.tone ?? 'stop'} state-{data.state}"
	class:selected
	title={data.node.detail ?? data.node.source}
>
	<span class="label">{data.node.label}</span>
	{#if exits}<span class="exit">exit {exits}</span>{/if}
</div>

<style>
	.terminal {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 0 12px;
		border-radius: 999px;
		border: 1.5px solid;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
		overflow: hidden;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.exit {
		font-weight: 400;
		opacity: 0.75;
	}
	.tone-entry {
		background: var(--entry-bg);
		border-color: var(--entry-border);
		color: var(--entry-ink);
	}
	.tone-success {
		background: var(--success-bg);
		border-color: var(--success-border);
		color: var(--success-ink);
	}
	.tone-stop {
		background: var(--stop-bg);
		border-color: var(--stop-border);
		color: var(--stop-ink);
	}
	.selected {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>

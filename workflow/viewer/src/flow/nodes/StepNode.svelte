<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import type { StepNodeType } from '../layout';
	import Handles from './Handles.svelte';

	let { data, selected }: NodeProps<StepNodeType> = $props();
</script>

<Handles />
<div class="step state-{data.state}" class:selected title={data.node.detail ?? data.node.source}>
	{data.node.label}
	{#if data.node.note}<span class="note-mark" aria-label="has a note">*</span>{/if}
</div>

<style>
	.step {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 10px;
		text-align: center;
		font-size: 12.5px;
		line-height: 1.2;
		color: var(--ink);
		background: var(--step-bg);
		border: 1.5px solid var(--step-border);
		border-radius: 6px;
	}
	.selected {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.note-mark {
		color: var(--accent);
		margin-left: 2px;
	}
</style>

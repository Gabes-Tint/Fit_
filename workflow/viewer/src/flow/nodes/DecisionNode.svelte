<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import type { DecisionNodeType } from '../layout';
	import Handles from './Handles.svelte';

	let { data, selected }: NodeProps<DecisionNodeType> = $props();
</script>

<Handles />
<div
	class="decision state-{data.state}"
	class:selected
	title={data.node.detail ?? data.node.source}
>
	<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
		<polygon points="50,1 99,50 50,99 1,50" />
	</svg>
	<span class="label">
		{data.node.label}
		{#if data.node.note}<span class="note-mark" aria-label="has a note">*</span>{/if}
	</span>
</div>

<style>
	.decision {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	polygon {
		fill: var(--decision-bg);
		stroke: var(--decision-border);
		stroke-width: 1.5px;
		vector-effect: non-scaling-stroke;
	}
	.selected polygon {
		stroke: var(--accent);
		stroke-width: 3px;
	}
	.label {
		position: relative;
		max-width: 62%;
		text-align: center;
		font-size: 11.5px;
		line-height: 1.15;
		color: var(--ink);
	}
	.note-mark {
		color: var(--accent);
	}
</style>

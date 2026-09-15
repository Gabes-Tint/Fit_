<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import type { BlockNodeType } from '../layout';

	let { data }: NodeProps<BlockNodeType> = $props();
</script>

<div class="block block-{data.block.id}">
	<h2>{data.block.title}</h2>
</div>

<style>
	.block {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		border: 1px dashed var(--block-border);
		border-radius: 12px;
		background: var(--block-bg);
	}
	h2 {
		margin: 0;
		padding: 12px 16px;
		font-size: 15px;
		font-weight: 650;
		color: var(--block-ink);
	}
	.block-resume,
	.block-reset {
		background: var(--lane-bg);
	}
</style>

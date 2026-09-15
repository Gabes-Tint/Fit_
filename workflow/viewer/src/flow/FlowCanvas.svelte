<script lang="ts">
	import type { FlowBlock, FlowEdge, FlowNode } from './graph';
	import { layoutGraph } from './layout';
	import FlowView from './FlowView.svelte';

	interface Props {
		blocks: FlowBlock[];
		graphNodes: FlowNode[];
		graphEdges: FlowEdge[];
		onselect: (node: FlowNode | null) => void;
	}

	let { blocks, graphNodes, graphEdges, onselect }: Props = $props();

	const laid = $derived(layoutGraph(blocks, graphNodes, graphEdges));
</script>

{#await laid}
	<p class="status">Laying out the flow…</p>
{:then result}
	<FlowView nodes={result.nodes} edges={result.edges} {onselect} />
{:catch error}
	<p class="status">Layout failed: {error instanceof Error ? error.message : String(error)}</p>
{/await}

<style>
	.status {
		padding: 24px;
		color: var(--muted);
	}
</style>

<script lang="ts">
	import {
		Background,
		Controls,
		MiniMap,
		SvelteFlow,
		type EdgeTypes,
		type NodeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import type { FlowNode } from './graph';
	import type { ViewerEdge, ViewerNode } from './layout';
	import BlockNode from './nodes/BlockNode.svelte';
	import DecisionNode from './nodes/DecisionNode.svelte';
	import StepNode from './nodes/StepNode.svelte';
	import TerminalNode from './nodes/TerminalNode.svelte';
	import ElkEdge from './ElkEdge.svelte';

	interface Props {
		nodes: ViewerNode[];
		edges: ViewerEdge[];
		onselect: (node: FlowNode | null) => void;
	}

	let { nodes = $bindable(), edges = $bindable(), onselect }: Props = $props();

	const nodeTypes: NodeTypes = {
		step: StepNode,
		decision: DecisionNode,
		terminal: TerminalNode,
		block: BlockNode
	};
	const edgeTypes: EdgeTypes = { elk: ElkEdge };
</script>

<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	{edgeTypes}
	fitView
	minZoom={0.05}
	maxZoom={2}
	nodesDraggable={false}
	nodesConnectable={false}
	onnodeclick={({ node }) => onselect(node.type === 'block' ? null : node.data.node)}
	onpaneclick={() => onselect(null)}
>
	<Background />
	<Controls showLock={false} />
	<MiniMap pannable zoomable />
</SvelteFlow>

<style>
	:global(.flow-handle) {
		opacity: 0;
		pointer-events: none;
	}
	:global(.svelte-flow__edge-path) {
		stroke: var(--edge);
		stroke-width: 1.3px;
	}
	:global(.svelte-flow__edge-label) {
		background: var(--label-bg);
		color: var(--muted);
		font-size: 10.5px;
		padding: 0 3px;
		border-radius: 3px;
	}
</style>

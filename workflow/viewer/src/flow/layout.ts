/**
 * Turns the flow graph into positioned Svelte Flow nodes and routed edges with
 * ELK's layered algorithm: blocks become containers, edges are routed
 * orthogonally across them, and coordinates come back ready to draw.
 */
import { MarkerType, type Edge, type Node } from '@xyflow/svelte';
import { elkGraph, runElk } from './elk';
import type { FlowBlock, FlowEdge, FlowNode } from './graph';

/** Live run state a later slice will drive; unused by the static view. */
export type RunState = 'idle' | 'active' | 'passed' | 'failed';

export type FlowNodeData = { node: FlowNode; state: RunState };
export type BlockNodeData = { block: FlowBlock };
export type ElkEdgeData = {
	edge: FlowEdge;
	points: { x: number; y: number }[];
	labelX: number;
	labelY: number;
};

export type StepNodeType = Node<FlowNodeData, 'step'>;
export type DecisionNodeType = Node<FlowNodeData, 'decision'>;
export type TerminalNodeType = Node<FlowNodeData, 'terminal'>;
export type BlockNodeType = Node<BlockNodeData, 'block'>;
export type ViewerNode = StepNodeType | DecisionNodeType | TerminalNodeType | BlockNodeType;
export type ViewerEdge = Edge<ElkEdgeData, 'elk'>;

export async function layoutGraph(
	blocks: FlowBlock[],
	nodes: FlowNode[],
	edges: FlowEdge[]
): Promise<{ nodes: ViewerNode[]; edges: ViewerEdge[] }> {
	const laid = await runElk(elkGraph(blocks, nodes, edges));
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const blockById = new Map(blocks.map((block) => [block.id, block]));

	const viewerNodes: ViewerNode[] = [];
	for (const container of laid.children ?? []) {
		const block = blockById.get(container.id as FlowBlock['id']);
		if (!block) continue;
		viewerNodes.push({
			id: block.id,
			type: 'block',
			position: { x: container.x ?? 0, y: container.y ?? 0 },
			width: container.width ?? 0,
			height: container.height ?? 0,
			data: { block },
			selectable: false,
			zIndex: -1
		});
		for (const child of container.children ?? []) {
			const node = byId.get(child.id);
			if (!node) continue;
			viewerNodes.push({
				id: node.id,
				type: node.kind,
				parentId: block.id,
				position: { x: child.x ?? 0, y: child.y ?? 0 },
				width: child.width ?? 0,
				height: child.height ?? 0,
				data: { node, state: 'idle' }
			});
		}
	}

	const laidEdges = new Map((laid.edges ?? []).map((edge) => [edge.id, edge]));
	const viewerEdges: ViewerEdge[] = edges.map((edge, index) => {
		const routed = laidEdges.get(`e${index}`);
		const section = routed?.sections?.[0];
		const points = section
			? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
			: [];
		const label = routed?.labels?.[0];
		return {
			id: `e${index}`,
			type: 'elk',
			source: edge.from,
			target: edge.to,
			markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
			data: {
				edge,
				points,
				labelX: (label?.x ?? 0) + (label?.width ?? 0) / 2,
				labelY: (label?.y ?? 0) + (label?.height ?? 0) / 2
			}
		};
	});

	return { nodes: viewerNodes, edges: viewerEdges };
}

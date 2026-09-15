/**
 * The ELK graph for the flow: blocks as containers, nodes sized by kind,
 * edges with measured labels. Free of Svelte Flow so it can run anywhere.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { FlowBlock, FlowEdge, FlowNode, NodeKind } from './graph';

export const SIZE: Record<NodeKind, { width: number; height: number }> = {
	step: { width: 180, height: 48 },
	decision: { width: 190, height: 84 },
	terminal: { width: 200, height: 38 }
};

const labelWidth = (text: string) => Math.ceil(text.length * 6.2) + 10;

export function elkGraph(blocks: FlowBlock[], nodes: FlowNode[], edges: FlowEdge[]): ElkNode {
	return {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'DOWN',
			'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.json.edgeCoords': 'ROOT',
			'elk.spacing.nodeNode': '28',
			'elk.layered.spacing.nodeNodeBetweenLayers': '36',
			'elk.spacing.edgeNode': '14',
			'elk.spacing.edgeEdge': '8',
			'elk.spacing.edgeLabel': '2',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.edgeLabels.inline': 'true'
		},
		children: blocks.map((block) => ({
			id: block.id,
			layoutOptions: { 'elk.padding': '[top=44,left=20,bottom=20,right=20]' },
			children: nodes
				.filter((node) => node.block === block.id)
				.map((node) => ({ id: node.id, ...SIZE[node.kind] }))
		})),
		edges: edges.map((edge, index): ElkExtendedEdge => ({
			id: `e${index}`,
			sources: [edge.from],
			targets: [edge.to],
			labels: edge.label
				? [{ id: `e${index}-label`, text: edge.label, width: labelWidth(edge.label), height: 16 }]
				: []
		}))
	};
}

/** Lays the graph out; elkjs is loaded on first use to keep it out of the entry chunk. */
export async function runElk(graph: ElkNode): Promise<ElkNode> {
	const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
	return new ELK().layout(graph);
}

<script lang="ts">
	import { OUTCOMES, type FlowBlock, type FlowEdge, type FlowNode } from './graph';

	interface Props {
		node: FlowNode;
		blocks: FlowBlock[];
		nodes: FlowNode[];
		edges: FlowEdge[];
		onclose: () => void;
	}

	let { node, blocks, nodes, edges, onclose }: Props = $props();

	const labelOf = (id: string) => nodes.find((candidate) => candidate.id === id)?.label ?? id;
	const blockTitle = $derived(blocks.find((block) => block.id === node.block)?.title ?? node.block);
	const incoming = $derived(edges.filter((edge) => edge.to === node.id));
	const outgoing = $derived(edges.filter((edge) => edge.from === node.id));
</script>

<aside>
	<header>
		<span class="kind">{node.tone ?? node.kind}</span>
		<button type="button" onclick={onclose} aria-label="Close details">×</button>
	</header>
	<h3>{node.label}</h3>
	<p class="meta">{blockTitle}</p>
	<p><code>workflow/{node.source}</code></p>
	{#if node.detail}<p>{node.detail}</p>{/if}
	{#if node.note}<p class="note"><strong>Note:</strong> {node.note}</p>{/if}
	{#if node.outcomes?.length}
		<ul class="outcomes">
			{#each node.outcomes as outcome (outcome)}
				<li><code>{outcome}</code> exit {OUTCOMES[outcome]}</li>
			{/each}
		</ul>
	{/if}
	{#if incoming.length}
		<h4>From</h4>
		<ul>
			{#each incoming as edge (edge.from + (edge.label ?? ''))}
				<li>{labelOf(edge.from)}{edge.label ? ` (${edge.label})` : ''}</li>
			{/each}
		</ul>
	{/if}
	{#if outgoing.length}
		<h4>To</h4>
		<ul>
			{#each outgoing as edge (edge.to + (edge.label ?? ''))}
				<li>{edge.label ? `${edge.label} → ` : ''}{labelOf(edge.to)}</li>
			{/each}
		</ul>
	{/if}
	<p class="id">id <code>{node.id}</code></p>
</aside>

<style>
	aside {
		position: absolute;
		top: 12px;
		right: 12px;
		width: min(340px, calc(100% - 24px));
		max-height: calc(100% - 24px);
		overflow-y: auto;
		box-sizing: border-box;
		padding: 14px 16px;
		background: var(--panel-bg);
		color: var(--ink);
		border: 1px solid var(--block-border);
		border-radius: 10px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.15);
		font-size: 13px;
		z-index: 10;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.kind {
		text-transform: uppercase;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	button {
		border: 0;
		background: none;
		font-size: 20px;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
	}
	h3 {
		margin: 6px 0 2px;
		font-size: 16px;
	}
	h4 {
		margin: 12px 0 4px;
		font-size: 12px;
		color: var(--muted);
	}
	.meta,
	.id {
		color: var(--muted);
		margin: 0 0 8px;
	}
	.note {
		border-left: 3px solid var(--accent);
		padding-left: 8px;
	}
	ul {
		margin: 0;
		padding-left: 18px;
	}
	code {
		font-size: 12px;
		word-break: break-all;
	}
</style>

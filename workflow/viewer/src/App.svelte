<script lang="ts">
	import DetailPanel from './flow/DetailPanel.svelte';
	import FlowCanvas from './flow/FlowCanvas.svelte';
	import { blocks, edges, graphProblems, nodes, type FlowNode } from './flow/graph';

	let selected = $state<FlowNode | null>(null);
	const problems = graphProblems();
</script>

<main>
	<header>
		<h1>Fit_ development flow</h1>
		<p>
			{nodes.length} nodes · {edges.length} edges · from <code>workflow/go.py</code>
		</p>
		<ul class="legend">
			<li><span class="swatch step"></span>step</li>
			<li><span class="swatch decision"></span>decision</li>
			<li><span class="swatch success"></span>success</li>
			<li><span class="swatch stop"></span>stop</li>
			<li><span class="note-mark">*</span> has a note</li>
		</ul>
	</header>
	{#if problems.length}
		<ul class="problems">
			{#each problems as problem (problem)}<li>{problem}</li>{/each}
		</ul>
	{/if}
	<section class="canvas">
		<FlowCanvas
			{blocks}
			graphNodes={nodes}
			graphEdges={edges}
			onselect={(node) => (selected = node)}
		/>
		{#if selected}
			<DetailPanel node={selected} {blocks} {nodes} {edges} onclose={() => (selected = null)} />
		{/if}
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 18px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--block-border);
		background: var(--panel-bg);
	}
	h1 {
		margin: 0;
		font-size: 17px;
	}
	header p {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}
	.legend {
		display: flex;
		gap: 14px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: var(--muted);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.swatch {
		display: inline-block;
		width: 16px;
		height: 11px;
		border: 1.5px solid;
	}
	.swatch.step {
		background: var(--step-bg);
		border-color: var(--step-border);
		border-radius: 3px;
	}
	.swatch.decision {
		background: var(--decision-bg);
		border-color: var(--decision-border);
		transform: rotate(45deg) scale(0.75);
	}
	.swatch.success {
		background: var(--success-bg);
		border-color: var(--success-border);
		border-radius: 999px;
	}
	.swatch.stop {
		background: var(--stop-bg);
		border-color: var(--stop-border);
		border-radius: 999px;
	}
	.note-mark {
		color: var(--accent);
	}
	.problems {
		margin: 0;
		padding: 8px 32px;
		background: var(--stop-bg);
		color: var(--stop-ink);
	}
	.canvas {
		position: relative;
		flex: 1;
		min-height: 0;
	}
</style>

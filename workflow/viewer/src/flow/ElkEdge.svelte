<script lang="ts">
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
	import type { ViewerEdge } from './layout';

	let { id, data, markerEnd }: EdgeProps<ViewerEdge> = $props();

	const path = $derived.by(() => {
		const points = data?.points ?? [];
		return points
			.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
			.join(' ');
	});
</script>

<BaseEdge
	{id}
	{path}
	{markerEnd}
	label={data?.edge.label}
	labelX={data?.labelX}
	labelY={data?.labelY}
	class="flow-edge"
/>

<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
</script>

<Handle type="target" position={Position.Top} isConnectable={false} class="flow-handle" />
<Handle type="source" position={Position.Bottom} isConnectable={false} class="flow-handle" />

<script lang="ts">
	import Sheet from './Sheet.svelte';

	// Sheet takes its content as a snippet, which a props-only render cannot supply.
	let {
		open = $bindable(false),
		body,
		description,
		closable = false,
		tall = false
	}: {
		open?: boolean;
		body: string;
		description?: string | undefined;
		closable?: boolean;
		tall?: boolean;
	} = $props();

	function handleClose() {
		open = false;
	}
</script>

<Sheet bind:open title="Log" {description} {tall} onclose={closable ? handleClose : undefined}>
	<p>{body}</p>
</Sheet>

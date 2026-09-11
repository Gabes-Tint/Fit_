<script lang="ts">
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { page } from '$app/stores';

	const label = $derived($page.url.searchParams.get('label') ?? 'Test Badge');
</script>

<div class="p-4">
	<StatusBadge {label} />
</div>

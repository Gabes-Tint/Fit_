<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import AppShell from '$lib/components/AppShell.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<title>Fit_</title>
	<!-- Served from static/ rather than imported: importing it inlines the SVG as a
		base64 data URI into the always-loaded layout chunk. Files in static/ are not
		content-hashed, so changing the icon later needs a cache-busting thought. -->
	<link rel="icon" href="/favicon.svg" />
	<meta name="theme-color" content="#f3eee4" />
</svelte:head>

<AppShell {children} />

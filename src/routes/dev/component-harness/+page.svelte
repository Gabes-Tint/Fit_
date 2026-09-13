<script lang="ts">
	import { page } from '$app/state';
	import type { Component } from 'svelte';

	/**
	 * A test-only mount point for one component at a time.
	 *
	 * Playwright acceptance tests for a component that is not rendered by any
	 * page yet need a reachable URL, and a mechanic may not invent a route
	 * fixture (#380). This page is the repository-owned reusable answer: load
	 * it as `/dev/component-harness?component=<path>`, where `<path>` is the
	 * component module inside `src/lib/components` or `src/lib/ui`, with or
	 * without its directory (for example `components/StatusBadge` or just
	 * `StatusBadge`), plus optional `props` as JSON.
	 *
	 * Both globs deliberately cover only those two directories: routes, the
	 * shared store, server code and everything else cannot be reached from
	 * the harness, so it stays a component rig and cannot become a preview of
	 * arbitrary production files. Every component loads through its own lazy
	 * chunk, so the pages the phone ships do not pay for the harness.
	 *
	 * An unknown or unresolved id renders the distinctive
	 * `harness: component not found` line, which is what a failing acceptance
	 * test asserts before the component exists.
	 *
	 * It is a test-only surface, never part of the shipped app: the web
	 * server 404s `/dev/` without the runtime flag (`hooks.server.ts`), and
	 * the Capacitor build both refuses the URL (`+page.ts`) and drops the
	 * globs - a statically-true `VITE_CAPACITOR` tree-shakes them away, so
	 * no component chunk is emitted for the phone. Only the tiny page node
	 * itself remains in the static bundle's route manifest.
	 */
	type Loader = () => Promise<{ default: Component<Record<string, unknown>> }>;

	const loaders = (
		import.meta.env.VITE_CAPACITOR
			? {}
			: {
					...import.meta.glob('/src/lib/components/**/*.svelte'),
					...import.meta.glob('/src/lib/ui/**/*.svelte')
				}
	) as Record<string, Loader>;

	type Resolver =
		| { text: string; loader: null; props: Record<string, unknown> }
		| { text: string; loader: Loader; props: Record<string, unknown> };

	const request: Resolver = $derived.by(() => {
		const empty = { text: '', loader: null, props: {} as Record<string, unknown> };
		const id = (page.url.searchParams.get('component') ?? '').trim();
		if (!id) return { ...empty, text: 'harness: no component requested' };
		const loader = loaders[`/src/lib/${id}.svelte`] ?? namedLoader(id);
		if (!loader) return { ...empty, text: `harness: component not found: ${id}` };
		try {
			const props: unknown = JSON.parse(page.url.searchParams.get('props') ?? '{}');
			return { text: '', loader, props: props as Record<string, unknown> };
		} catch {
			return { ...empty, text: `harness: props is not valid JSON: for ${id}` };
		}
	});

	let rendered: {
		text: string;
		component: Component<Record<string, unknown>> | null;
		props: Record<string, unknown>;
	} = $state({ text: '', component: null, props: {} });

	$effect(() => {
		const current = request;
		if (current.loader === null) {
			rendered = { text: current.text, component: null, props: {} };
			return;
		}
		let alive = true;
		current
			.loader()
			.then((module) => {
				if (alive)
					rendered = {
						text: '',
						component: module.default,
						props: current.props
					};
			})
			.catch(() => {
				if (alive)
					rendered = {
						text: 'harness: component failed to load',
						component: null,
						props: {}
					};
			});
		return () => {
			alive = false;
		};
	});

	function namedLoader(id: string): Loader | undefined {
		const matches = Object.entries(loaders).filter(([path]) => path.endsWith(`/${id}.svelte`));
		if (matches.length !== 1) return undefined;
		return matches[0]?.[1];
	}
</script>

<svelte:head>
	<title>Component harness · Fit_</title>
</svelte:head>

<main data-testid="component-harness">
	{#if rendered.component}
		{@const Harness = rendered.component}
		<Harness {...rendered.props} />
	{:else}
		<p data-testid="harness-status">{rendered.text}</p>
	{/if}
</main>

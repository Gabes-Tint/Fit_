<script lang="ts">
	import { sync } from '$lib/state/sync.svelte';
	import { tend } from '$lib/state/tend.svelte';
	import { cn } from '$lib/ui/cn';
	import { OUTDATED_MESSAGE } from '$lib/domain/state-document';
	import { TOO_LARGE_MESSAGE } from '$lib/domain/state-size';
	import { STORAGE_FULL_MESSAGE } from '$lib/state/storage-quota';

	/**
	 * How long a save or a background read may run before it is worth mentioning.
	 *
	 * Most writes land in well under this on any connection worth the name, and
	 * saying nothing for that long is the point — logging a meal must not come
	 * with a running commentary on sync. A write still open past this delay has
	 * become noticeable on its own account, and this is where the app admits it
	 * rather than letting someone wonder if their tap registered.
	 */
	const NOTICE_DELAY_MS = 400;

	/**
	 * How long a notice stays up once shown, even if the state behind it has
	 * already resolved.
	 *
	 * Without this, a connection where each save takes about half a second
	 * shows and hides "Saving…" roughly once a second while someone logs
	 * several things in a row — this is what stops that strobing.
	 */
	const MIN_VISIBLE_MS = 900;

	type Kind = 'none' | 'busy' | 'waiting' | 'error';

	// A single node whose text is swapped in and out, never mounted or
	// unmounted: screen readers only announce a mutation to a live region
	// that already existed, not one created together with its own content.
	let kind = $state<Kind>('none');
	let text = $state('');
	let shownAt = 0;

	function show(next: Kind, message: string) {
		kind = next;
		text = message;
		shownAt = Date.now();
	}

	function hide() {
		kind = 'none';
		text = '';
	}

	/**
	 * The one notice that outranks every other: data written by a newer build
	 * than this one is here, and until the app is updated nothing on this device
	 * will be sent or overwritten. Saying so is what stops it reading as "sync is
	 * broken" — nothing is broken and nothing was lost.
	 */
	const halted = $derived(
		tend.refusal?.message ??
			// Ranked above the server's ceiling and above being offline: those two
			// leave the changes safe on the device and this one is the device
			// saying it could not take them, so it is the only notice here that
			// asks for something to be done before the tab closes.
			(tend.storage === 'full' ? STORAGE_FULL_MESSAGE : null) ??
			(sync.status === 'outdated' ? OUTDATED_MESSAGE : null)
	);

	$effect(() => {
		const status = sync.status;
		if (halted !== null) {
			show('error', halted);
			return;
		}
		if (status === 'waiting') {
			show(
				'waiting',
				"Offline. Your changes are saved on this device and will send once you're back online."
			);
			return;
		}
		if (status === 'too-large') {
			// Stays up: nothing is being sent and nothing will be until the
			// document is smaller, so this is a standing condition rather than a
			// passing one. Its wording says the data is safe first, because that
			// is the question a red notice about your journal raises.
			show('error', TOO_LARGE_MESSAGE);
			return;
		}
		if (status === 'error') {
			show(
				'error',
				"Couldn't reach the server. Your changes are saved here and we'll keep trying."
			);
			return;
		}
		if (status === 'saving' || status === 'loading') {
			const id = setTimeout(() => show('busy', 'Saving…'), NOTICE_DELAY_MS);
			return () => clearTimeout(id);
		}
		// idle or stale: nothing left to report. A notice already up keeps its
		// minimum stretch rather than vanishing out from under someone's finger.
		const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt);
		if (kind !== 'none' && remaining > 0) {
			const id = setTimeout(hide, remaining);
			return () => clearTimeout(id);
		}
		hide();
	});

	const toneClass = $derived(
		kind === 'waiting'
			? 'bg-secondary text-secondary-foreground rounded-2xl px-3 py-2 font-medium pointer-events-auto'
			: kind === 'error'
				? 'bg-destructive text-destructive-foreground rounded-2xl px-3 py-2 font-medium pointer-events-auto'
				: kind === 'busy'
					? 'text-muted-foreground pointer-events-auto'
					: ''
	);
</script>

<!--
	Fixed and out of document flow, so a notice appearing or clearing never
	shifts the content underneath — the same reason a save every few hundred
	milliseconds must not jump whatever someone is about to tap. Positioned
	the way `AppShell`'s toaster is: below `TopBar`'s own height and safe area.
-->
<div
	class={cn(
		'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-5 transition-opacity duration-150',
		kind === 'none' && 'opacity-0'
	)}
	style="top: calc(3.5rem + env(safe-area-inset-top) + 0.5rem)"
>
	<p role="status" class={cn('flex w-full max-w-lg items-center gap-2 text-sm', toneClass)}>
		{#if kind === 'waiting'}
			<span
				class="border-secondary-foreground/70 size-2 shrink-0 rounded-full border-2"
				aria-hidden="true"
			></span>
		{:else if kind === 'error'}
			<span class="bg-destructive-foreground size-2 shrink-0 rounded-full" aria-hidden="true"
			></span>
		{:else if kind === 'busy'}
			<span
				class="border-muted-foreground/30 border-t-muted-foreground size-3.5 shrink-0 animate-spin rounded-full border-2"
				aria-hidden="true"
			></span>
		{/if}
		{text}
	</p>
</div>

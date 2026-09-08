<script lang="ts">
	import { toasts } from './toast.svelte';

	let {
		/**
		 * How far below the top of the screen the stack begins, as a CSS length.
		 * The caller owns it because the caller is what the toasts have to clear;
		 * `AppShell` derives it from `TopBar`'s height and safe area.
		 */
		offset
	}: { offset: string } = $props();
</script>

<!--
	The region is mounted for the life of the app and empty most of it. That is
	deliberate and is the same rule `SyncStatusBadge` follows: a screen reader
	announces a mutation to a live region it already knew about, and says nothing
	at all about one that arrived with its own content already inside it.

	`aria-live` rather than `role="status"` or `role="alert"`, because both of
	those roles are already spoken for on these screens — the sync notice is the
	status and a form's rejection is the alert — and a second element answering
	to either name would make "the status" ambiguous to anything looking for one.

	Above `Sheet`'s `z-50`, and not by accident: the log sheet raises six of these
	from inside an open dialog, and a dialog that portals to the end of the body
	wins a tie on stacking order.
-->
<div
	aria-live="polite"
	class="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-5"
	style="top: {offset}"
>
	{#each toasts.items as item (item)}
		<!--
			`wrap-anywhere` and the shared `max-w-lg` column are what keep a long
			sentence from widening the page at 360px (#152); the box is the width of
			the content underneath it either way.
		-->
		<p
			class="toast bg-card text-card-foreground shadow-border w-full max-w-lg rounded-2xl px-4 py-3 text-sm wrap-anywhere"
		>
			{item.message}
		</p>
	{/each}
</div>

<style>
	/*
		A short fade down from behind the top bar, so a sentence that appears while
		someone is looking at the bottom of the screen still catches the eye.
		Leaving is not animated: the node goes when the queue drops it, which is
		four seconds after anyone had a reason to look at it. There is no media
		query here because `app.css` already shortens every animation on the page
		to nothing under `prefers-reduced-motion`.
	*/
	.toast {
		animation: toast-in 150ms ease-out;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
	}
</style>

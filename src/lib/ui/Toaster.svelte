<script lang="ts">
	import { toasts, type Toast } from './toast.svelte';

	let {
		/**
		 * How far below the top of the screen the stack begins, as a CSS length.
		 * The caller owns it because the caller is what the toasts have to clear;
		 * `AppShell` derives it from `TopBar`'s height and safe area.
		 */
		offset
	}: { offset: string } = $props();

	/**
	 * Take the toast away first, then do the thing.
	 *
	 * One that leaves its own toast standing reads as an action that did not
	 * take. Dismissing first also means a handler that throws still leaves the
	 * screen clear, and that the timer still armed against this entry finds
	 * nothing left to remove — which `dismiss` is written to tolerate.
	 */
	function act(item: Toast): void {
		toasts.dismiss(item);
		item.action?.onClick();
	}
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

	`style={...}` rather than `style="top: {offset}"`: the quoted form compiles to
	`offset ?? ''`, and the empty half of that is a branch no caller can reach.
-->
<div
	aria-live="polite"
	class="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-5"
	style={`top: ${offset}`}
>
	{#each toasts.items as item (item)}
		{@const action = item.action}
		<!--
			One box shape whether or not there is a button, so a sentence sits in the
			same place either way and there is one set of paddings to keep true.
			`wrap-anywhere` and the shared `max-w-lg` column are what keep a long
			sentence from widening the page at 360px (#152); both stay on the box
			rather than moving down to the text, because `overflow-wrap` inherits and
			the width is the box's business.
		-->
		<div
			class="toast bg-card text-card-foreground shadow-border flex w-full max-w-lg items-center gap-2 rounded-2xl px-4 py-3 text-sm wrap-anywhere"
		>
			<span class="min-w-0 flex-1">{item.message}</span>
			{#if action}
				<!--
					`pointer-events-auto` because the column above turns them off: these
					float over the day's rows and must not eat taps meant for them, but
					the buttons in the column are there to be tapped. `min-h-11` for the
					same reason it is on the other one-tap targets — a thumb aiming for
					one of these over a list it has just been tapping down needs the
					whole 44px.

					The accessible name is the same word shown on screen: with "Dismiss"
					sitting right beside it, "Undo" on its own is no longer a word read
					out of nowhere, and a caller-specific sentence in the name would make
					two buttons that read differently for the same reason.

					`text-destructive` is text only, no fill — the toast keeps its own
					background, and this is the one action of the two that removes
					something.
				-->
				<button
					type="button"
					onclick={() => act(item)}
					class="text-destructive focus-visible:ring-ring pointer-events-auto -my-1 flex min-h-11 shrink-0 items-center rounded-full px-3 font-medium focus-visible:ring-2 focus-visible:outline-none"
				>
					{action.label}
				</button>
			{/if}
			{#if item.dismissible}
				<!--
					The escape hatch next to the action: it takes the toast away without
					doing anything else, so waving off a message that needs no undoing
					costs a tap rather than a wait. Same hit target as the action beside
					it, and the toast's own text color rather than a second accent —
					there is nothing here to draw the eye to.
				-->
				<button
					type="button"
					onclick={() => toasts.dismiss(item)}
					class="text-card-foreground focus-visible:ring-ring pointer-events-auto -my-1 flex min-h-11 shrink-0 items-center rounded-full px-3 font-medium focus-visible:ring-2 focus-visible:outline-none"
				>
					Dismiss
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	/*
		A short fade down from behind the top bar, so a sentence that appears while
		someone is looking at the bottom of the screen still catches the eye.
		Leaving is not animated: the node goes when the queue drops it, which is
		once nobody had a reason to look at it any more — or the moment its button
		is pressed, and an undo that fades out slowly reads as one that did not
		take. There is no media query here because `app.css` already shortens every
		animation on the page to nothing under `prefers-reduced-motion`.
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

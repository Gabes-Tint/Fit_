<script module lang="ts">
	/**
	 * The drawer this button opens, named so the button can point at it.
	 *
	 * `SideNav` stamps it on `Dialog.Content` and this file spends it on
	 * `aria-controls`, so the two cannot drift apart in a rename.
	 */
	export const DRAWER_ID = 'app-drawer';

	/**
	 * How the drawer tells apart a tap that landed on this button.
	 *
	 * The button floats *above* the drawer's own overlay, which makes every tap
	 * on it an "interact outside" as far as `bits-ui` is concerned: the drawer
	 * would close itself on `pointerdown` and this button's own `click`, arriving
	 * a moment later, would open it straight back up. `SideNav` matches the
	 * event's target against this and declines to close, leaving the toggle below
	 * as the only thing that decides.
	 */
	export const MENU_FAB_SELECTOR = '[data-menu-fab]';
</script>

<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import Button from '$lib/ui/Button.svelte';

	// `open` is reported, not owned: the shell holds the drawer, this only draws
	// which of the two faces the button is currently wearing and says so.
	// `leftHanded` mirrors the button to the opposite corner; the shell reads it
	// from the tend store, this component only lays out for it.
	let {
		open,
		ontoggle,
		leftHanded = false
	}: { open: boolean; ontoggle: () => void; leftHanded?: boolean } = $props();

	/**
	 * Any dialog on screen that is not the drawer this button owns — a log
	 * sheet, a routine sheet, a confirm modal. Every one of them is painted
	 * above this button and traps focus inside itself, so a tap cannot reach
	 * here while one is up; this is the belt to that pair of braces, and it
	 * costs one selector on a tap rather than an observer on every mutation.
	 *
	 * It matters because the failure it prevents is silent: opening the drawer
	 * underneath an open sheet puts a menu nobody can see or reach behind the
	 * thing they are actually using, with this button reporting it as expanded.
	 */
	function coveredByASheet() {
		return document.querySelector(`[data-dialog-content]:not(#${DRAWER_ID})`) !== null;
	}

	function toggle() {
		if (coveredByASheet()) return;
		ontoggle();
	}
</script>

<!--
	The one persistent control on the screen, and the reason there is no top bar
	left to carry it.

	Fixed and column-aligned the way `SyncStatusBadge` is, but pinned to the
	bottom of the viewport and right-aligned within the app column: on a phone
	that corner is where a thumb already rests, and the top of the screen is
	given back to the journal.

	It sits in a tier of its own: above `SideNav`'s overlay and panel (`z-40`),
	so the button does not disappear behind the drawer it opened and the same
	thumb in the same place closes what it just opened — and below `Sheet` and
	`Modal` (`z-50`), so an open sheet covers it completely rather than leaving
	it floating over a row somebody is trying to press. The wrapper takes no
	pointer events, so everywhere the button is not, a tap still reaches
	whatever is underneath, and a tap on the drawer's overlay still closes it.

	Tucked to `0.75rem` from each edge rather than the `1.25rem` a floating
	action button usually takes. The Today cards right-align their own actions
	against the same edge, and how much of one this circle clips is a matter of
	how far its centre is from theirs — the margin at 390x844, the tightest of
	the phone widths, is three pixels of it. `phone-layout.e2e.ts` sweeps every
	card action at three widths so a change to either shape is caught here
	rather than on somebody's phone.
-->
<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
	style={leftHanded
		? 'padding-right:calc(var(--spacing) * 5);padding-left:max(0.75rem,env(safe-area-inset-left))'
		: 'padding-right:max(0.75rem,env(safe-area-inset-right));padding-left:calc(var(--spacing) * 5)'}
>
	<div
		class="flex w-full max-w-lg"
		style={leftHanded ? 'justify-content:flex-start' : 'justify-content:flex-end'}
	>
		<Button
			size="icon-round"
			class="shadow-border pointer-events-auto shadow-lg"
			onclick={toggle}
			aria-label={open ? 'Close menu' : 'Open menu'}
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-controls={DRAWER_ID}
			data-menu-fab=""
		>
			{#if open}
				<X class="size-6" />
			{:else}
				<Menu class="size-6" />
			{/if}
		</Button>
	</div>
</div>

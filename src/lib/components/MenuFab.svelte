<script module lang="ts">
	/**
	 * The drawer this button opens, named so the button can point at it.
	 *
	 * `SideNav` stamps it on `Dialog.Content` and this file spends it on
	 * `aria-controls`, so the two cannot drift apart in a rename.
	 */
	export const DRAWER_ID = 'app-drawer';

	/**
	 * How the drawer recognises a tap that landed on this button.
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
	let { open, ontoggle }: { open: boolean; ontoggle: () => void } = $props();
</script>

<!--
	The one persistent control on the screen, and the reason there is no top bar
	left to carry it.

	Fixed and column-aligned the way `SyncStatusBadge` is, but pinned to the
	bottom of the viewport and right-aligned within the app column: on a phone
	that corner is where a thumb already rests, and the top of the screen is
	given back to the journal.

	`z-[60]` is the whole point of it, and it is above `SideNav`'s overlay and
	panel (`z-50`) deliberately: the button does not disappear behind the drawer
	it opened, it stays on screen wearing an X so the same thumb in the same
	place closes what it just opened. The wrapper takes no pointer events, so
	everywhere the button is not, a tap still reaches the overlay underneath and
	closes the drawer that way.
-->
<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center pt-2 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-5"
>
	<div class="flex w-full max-w-lg justify-end">
		<Button
			size="icon-round"
			class="shadow-border pointer-events-auto shadow-lg"
			onclick={ontoggle}
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

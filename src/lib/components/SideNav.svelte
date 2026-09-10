<script lang="ts">
	import { Dialog } from 'bits-ui';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Dumbbell from '@lucide/svelte/icons/dumbbell';
	import Home from '@lucide/svelte/icons/house';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import UserRound from '@lucide/svelte/icons/user-round';
	import X from '@lucide/svelte/icons/x';
	import { resolve } from '$app/paths';
	import { APP_VERSION } from '$lib/version';
	import AccountMenu from './auth/AccountMenu.svelte';
	import { DRAWER_ID, MENU_FAB_SELECTOR } from './MenuFab.svelte';
	import NavLink from './NavLink.svelte';
	import type { NavRoute } from './nav-routes';

	// pathname is a prop, not a $app/state read: the shell owns knowing where we are.
	// leftHanded mirrors the panel to the opposite edge; the shell reads it from
	// the tend store, this component only lays out for it.
	let {
		open = $bindable(false),
		pathname,
		leftHanded = false
	}: { open?: boolean; pathname: string; leftHanded?: boolean } = $props();

	type Destination = { route: NavRoute; label: string; icon: typeof Home; active: boolean };

	function destination(route: NavRoute, label: string, icon: typeof Home): Destination {
		return { route, label, icon, active: pathname === resolve(route) };
	}

	const destinations = $derived([
		destination('/', 'Today', Home),
		destination('/progress', 'Progress', TrendingUp),
		destination('/exercise', 'Exercise', Dumbbell),
		destination('/plan', 'Plan', CalendarDays),
		destination('/you', 'You', UserRound)
	]);

	/**
	 * A tap on the floating toggle is not a tap outside.
	 *
	 * The toggle floats above this drawer's overlay, so `bits-ui` sees every tap
	 * on it as an outside interaction and would close on `pointerdown` — leaving
	 * the toggle's own `click`, which arrives afterwards, to reopen what had just
	 * shut. Declining here leaves the toggle as the single thing that decides
	 * whether the drawer is open, and every other tap outside still closes it.
	 */
	function keepOpenForTheToggle(event: PointerEvent) {
		// The target is an element by the time this is called: `bits-ui` does not
		// count an interaction whose target is anything else as an outside one at
		// all, so it never reaches here.
		const target = event.target as Element;
		if (target.closest(MENU_FAB_SELECTOR) !== null) event.preventDefault();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-foreground/25 fixed inset-0 z-40" />
		<Dialog.Content
			id={DRAWER_ID}
			onInteractOutside={keepOpenForTheToggle}
			class={[
				'bg-card text-card-foreground fixed inset-y-0 z-40 flex w-[min(17rem,80vw)] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-border outline-none',
				leftHanded ? 'right-0 rounded-l-3xl' : 'left-0 rounded-r-3xl'
			]}
		>
			<!--
				The way out for anyone not using a thumb.

				The floating toggle is the close control a thumb reaches for, and it
				stays on screen wearing an X — but it is outside this panel, and a
				modal traps the tab ring inside itself, so Tab never reaches it and
				Escape would otherwise be the whole of the keyboard. This is the same
				exit by another route, in the tab ring and in the drawer's own header
				where a dialog's close belongs.

				Two controls end up named "Close menu" while the drawer is open, and
				that is less ambiguous than it looks: this is the only one inside the
				dialog, and a screen reader working a modal is scoped to the dialog,
				so it is the only one such a reader is offered.
			-->
			<div class="flex h-14 items-center justify-between gap-2 px-4">
				<Dialog.Title class="font-display text-xl tracking-tight">Fit_</Dialog.Title>
				<Dialog.Close
					class="text-muted-foreground hover:bg-secondary flex size-10 items-center justify-center rounded-xl"
				>
					<X class="size-4" />
					<span class="sr-only">Close menu</span>
				</Dialog.Close>
			</div>
			<Dialog.Description class="text-muted-foreground px-4 pb-3 text-xs">
				Everything stays on this device.
			</Dialog.Description>
			<nav class="flex flex-col gap-1 px-2">
				{#each destinations as item (item.route)}
					<NavLink {...item} />
				{/each}
			</nav>
			<AccountMenu />
			<!--
				Which build this is, small and muted at the foot of the drawer. It is
				text and nothing else: tapping it does nothing, and the visible half is
				the bare string so a screenshot is enough to tell a stale shell from a
				current one. The screen-reader half says what the number is.
			-->
			<p class="text-muted-foreground mt-auto px-4 pb-3 text-xs">
				<span class="sr-only">Version</span>
				<span>{APP_VERSION}</span>
			</p>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

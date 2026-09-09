<script lang="ts">
	import { Dialog } from 'bits-ui';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Dumbbell from '@lucide/svelte/icons/dumbbell';
	import Home from '@lucide/svelte/icons/house';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { resolve } from '$app/paths';
	import { APP_VERSION } from '$lib/version';
	import AccountMenu from './auth/AccountMenu.svelte';
	import { DRAWER_ID, MENU_FAB_SELECTOR } from './MenuFab.svelte';
	import NavLink from './NavLink.svelte';
	import type { NavRoute } from './nav-routes';

	// pathname is a prop, not a $app/state read: the shell owns knowing where we are.
	let { open = $bindable(false), pathname }: { open?: boolean; pathname: string } = $props();

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
		<Dialog.Overlay class="bg-foreground/25 fixed inset-0 z-50" />
		<Dialog.Content
			id={DRAWER_ID}
			onInteractOutside={keepOpenForTheToggle}
			class="bg-card text-card-foreground fixed inset-y-0 left-0 z-50 flex w-[min(17rem,80vw)] flex-col rounded-r-3xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-border outline-none"
		>
			<!--
				The wordmark, which used to head the top bar and now heads the only
				thing left that has a header. There is no close button beside it: the
				floating toggle outside this panel is the close control, wearing an X
				for as long as this is open, and a second control with the same name
				would only make a screen reader ask which one it meant.
			-->
			<div class="flex h-14 items-center px-4">
				<Dialog.Title class="font-display text-xl tracking-tight">Fit_</Dialog.Title>
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

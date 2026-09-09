<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { session } from '$lib/state/session.svelte';
	import { sync } from '$lib/state/sync.svelte';
	import { tend } from '$lib/state/tend.svelte';
	import Toaster from '$lib/ui/Toaster.svelte';
	import { AUTH_ROUTES, signInPath } from './auth/auth-routes';
	import InitialSync from './InitialSync.svelte';
	import MenuFab from './MenuFab.svelte';
	import SyncStatusBadge from './SyncStatusBadge.svelte';

	let { children }: { children: Snippet } = $props();

	/**
	 * How far below the top of the screen a toast sits.
	 *
	 * The safe area the screen begins after, and a gap. There is no bar left to
	 * clear — the menu moved to a floating toggle at the bottom of the screen and
	 * the top of it went back to the journal — so a toast now starts as high as
	 * the hardware allows and nothing it could cover is up there any more.
	 */
	const TOAST_OFFSET = 'calc(env(safe-area-inset-top) + 0.5rem)';

	let menuOpen = $state(false);

	onMount(() => {
		// The store reads `localStorage`, so hydrate waits for the client; nothing renders before then.
		tend.hydrate();
		// `session` reads `localStorage` too, so it hydrates here as well.
		session.hydrate();
		// The restored session may have been revoked elsewhere; ask the server once, only when signed in.
		if (session.signedIn) void session.refresh();
	});

	// Close the drawer on navigation; hooking navigation (not the link clicks) also covers the back button.
	afterNavigate(() => (menuOpen = false));

	/** Both stores read `localStorage`, and neither answers anything before it has. */
	const restored = $derived(tend.hydrated && session.hydrated);

	/**
	 * Set by `InitialSync`'s own "continue without waiting" action: a person
	 * held on the loading screen by a stuck connection is not made to wait for
	 * `sync`'s own ten-second timeout on top of it. Reset for every household
	 * that starts syncing, so the choice from one account never carries into
	 * the next one that signs in on this device.
	 */
	let skipInitialSync = $state(false);

	/**
	 * A device with no document of its own is, until its first pull settles,
	 * indistinguishable from one that has genuinely never onboarded — both read
	 * `tend.state.onboarded` as `false`. Showing Onboarding in that window would
	 * tell someone with months of history that it is gone; this is the moment
	 * that gate is held open instead.
	 *
	 * Only the very first pull for a household counts: once it has settled,
	 * `onboarded` is whatever it is, and any later reload rides quietly in the
	 * background the way it does for a returning device today.
	 */
	const awaitingFirstPull = $derived(
		!tend.state.onboarded && sync.status === 'loading' && !skipInitialSync
	);

	const pathname = $derived(page.url.pathname);
	const onAuthRoute = $derived(AUTH_ROUTES.some((route) => resolve(route) === pathname));

	/**
	 * The whole address that was asked for, fragment included.
	 *
	 * The fragment is the part it would be easiest to drop and hardest to
	 * notice: a link to `/exercise/session#set-3` that came back without it
	 * would look like it worked and land at the top of the page.
	 */
	const here = $derived(`${pathname}${page.url.search}${page.url.hash}`);

	/**
	 * A clock the gate can see.
	 *
	 * `session.signedIn` compares the expiry against `Date.now()`, and a wall
	 * clock is not reactive: left alone, a tab open past the expiry keeps
	 * rendering the app because nothing tells it the moment passed. That was a
	 * cosmetic staleness when the record only named an account in the drawer.
	 * It is not cosmetic now — it is the whole app on the wrong side of the gate
	 * — so the moment is waited for rather than noticed.
	 */
	let clock = $state(Date.now());

	/** A day. `setTimeout` overflows past ~24.9 days and fires at once. */
	const LONGEST_WAIT = 86_400_000;

	$effect(() => {
		const expiresAt = session.current?.expiresAt;
		if (expiresAt === undefined) return;
		const due = Date.parse(expiresAt) - clock;
		// The record is dropped rather than merely stopping counting: it describes
		// a session the server forgot, and the gate below reads what is left.
		if (due <= 0) {
			session.forget();
			return;
		}
		// A ninety-day session is far past what one timer can hold, so the wait is
		// taken a day at a time and re-armed by the tick this effect depends on.
		const id = setTimeout(() => (clock = Date.now()), Math.min(due, LONGEST_WAIT));
		return () => clearTimeout(id);
	});

	/**
	 * The document follows the account.
	 *
	 * Started here, once both stores have read `localStorage` and there is a
	 * household to sync, and stopped the moment there is not — a sign-out, or the
	 * expiry above. It is an effect for the same reason the gate below is: signing
	 * in and signing out change the session while the page sits still, and a
	 * `load` guard would only see navigation.
	 *
	 * Stopping is not emptying. The device keeps what it has until `AccountMenu`
	 * signs out deliberately, so an expired session does not take a journal with
	 * it; the household on the sync record is what keeps the next account from
	 * seeing this one's.
	 */
	$effect(() => {
		const household = restored && session.signedIn ? session.household : null;
		// A fresh household gets a fresh chance at the loading screen: someone
		// who chose to continue past a stuck pull on one account must not find
		// the choice still in effect for the next one that signs in here.
		skipInitialSync = false;
		if (household === null) {
			sync.stop();
			return;
		}
		void sync.start(household.householdId);
	});

	/**
	 * The gate.
	 *
	 * A client-side gate and nothing more: it decides what this device draws, and
	 * the server decides what it may have. That is not a weakness of this shell so
	 * much as the only thing it could be — `ssr` is off for both targets and the
	 * Capacitor build is static, so there is no server render to refuse. When the
	 * store starts fetching a journal, the endpoint behind it answers 401 to
	 * exactly the requests this hides, and that refusal is the real boundary.
	 *
	 * What it does buy is the product rule: nobody sees a page, a menu or a
	 * feature before they have signed in. Rendering nothing while the redirect
	 * runs is deliberate — a shell drawn first and replaced afterwards would show
	 * the journal it is meant to withhold.
	 *
	 * It is an effect rather than a `load` guard in `+layout.ts`, and that is the
	 * deliberate half of the design. A `load` guard runs on entry and on
	 * navigation, which are only one of the three ways someone ends up on the
	 * wrong side of this line: the other two are signing out and the expiry
	 * above, both of which change the session while the page sits still. One
	 * rule that watches the state covers all three; a `load` guard would cover
	 * the first and need a second mechanism for the rest.
	 */
	$effect(() => {
		if (!restored || onAuthRoute || session.signedIn) return;
		// Where they were headed rides along, so signing in lands on the page they
		// asked for rather than on the front one.
		void goto(signInPath(here), { replaceState: true });
	});
</script>

{#if restored}
	<div class="bg-background flex min-h-dvh justify-center">
		{#if onAuthRoute}
			<!--
				The forms carry no chrome. There is no top bar to open a drawer that
				would list destinations this visitor cannot reach, and no journal
				underneath: this is the whole screen until there is an account.
			-->
			<div class="flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-10">
				{@render children()}
			</div>
		{:else if session.signedIn}
			{#if awaitingFirstPull}
				<InitialSync
					onretry={() => void sync.flush()}
					oncontinue={() => (skipInitialSync = true)}
				/>
			{:else if tend.state.onboarded}
				<div class="bg-background flex min-h-dvh w-full max-w-lg flex-col">
					<SyncStatusBadge />
					<!--
						The journal starts at the top of the screen: `pt` is the gap plus
						whatever the hardware reserves, and no bar sits in between.

						`pb` is the room the floating toggle needs. It is 5.5rem rather
						than the gap alone so the last thing on the page can be scrolled
						clear of a button that never leaves the corner — the Today cards
						put their own actions in exactly that corner, and one of them
						being permanently unreachable at the foot of the page is the
						failure this padding exists to prevent.
					-->
					<div
						class="flex-1 px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
					>
						{@render children()}
					</div>
					<!--
						Fetched after the shell, for the same reason as the log sheet below.
						The drawer is the shell's only user of `bits-ui`, and `Dialog` brings
						its portal, focus scope and `tabbable` with it — the largest thing
						left in the root layout after the log sheet moved out, and none of it
						is on screen until somebody taps the menu button. It is still fetched
						on load rather than on the tap, so the drawer is ready long before a
						hand can reach it; a tap that does land first simply opens the drawer
						as it mounts, because `menuOpen` is already true by then.
					-->
					{#await import('./SideNav.svelte') then { default: SideNav }}
						<SideNav bind:open={menuOpen} {pathname} />
					{/await}
					<!--
						Rendered outside the drawer and never with it: the toggle is the
						one control that is always on screen, and it wears an X while the
						drawer is open so the thumb that opened it closes it again without
						moving. Not inside the `{#await}` above, because the button has to
						be there to be tapped before the drawer's chunk has landed —
						`menuOpen` is simply already true when it does.
					-->
					<MenuFab open={menuOpen} ontoggle={() => (menuOpen = !menuOpen)} />
					<!--
						Fetched after the shell rather than inside it. The log sheet and
						everything it can show — the search, the proposal rows, the photo
						pane, the barcode reader and their cameras — is the largest thing
						the root layout carries, and none of it is needed until somebody
						taps Log. Measured in `docs/bundle-audit.md`, which argued for
						exactly this split and cut the budgets to let it land: it takes
						the JavaScript every page loads from 273,414 bytes to 224,371.
					-->
					{#await import('./LogSheet.svelte') then { default: LogSheet }}
						<LogSheet />
					{/await}
				</div>
			{:else}
				<!--
					Onboarding is the one screen here that a returning device never draws,
					and it carries the whole profile form and its `bits-ui` switch. Fetching
					it inside this branch means it is asked for only by a device that has
					actually reached it — once, before there is an account to return to —
					instead of by every load for the rest of that account's life.
				-->
				{#await import('./Onboarding.svelte') then { default: Onboarding }}
					<Onboarding />
				{/await}
			{/if}
		{/if}
		<!--
			One toaster for every branch, mounted outside all of them.

			Signing out is a toast immediately followed by the branch above
			swapping: `session.forget()` changes what this renders, and a toaster
			inside the branch being left is unmounted mid-announcement and takes
			the message with it.

			Top rather than the bottom corner a toast usually takes, because the
			bottom of the screen is where this application puts things to press.
			`Sheet` is `fixed bottom-0` and `LogSheet` raises six of these from
			inside it; `Onboarding` pins its actions there with `sticky bottom-0`.
			On a phone a toast is the width of the column anyway, so a corner would
			be a corner in name only.
		-->
		<Toaster offset={TOAST_OFFSET} />
	</div>
{/if}

<script lang="ts">
	import { signOut, signOutEverywhere } from '$lib/auth/api';
	import { failureWording } from '$lib/auth/wording';
	import { session } from '$lib/state/session.svelte';
	import { sync } from '$lib/state/sync.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	/**
	 * The account, at the foot of the drawer.
	 *
	 * There is no signed-out half any more, and there cannot be one: the drawer
	 * is inside the gate, so a visitor who is not signed in never reaches a
	 * screen that has a drawer on it. Signing out empties the device — the
	 * journal belongs to the account and the server is holding it — and returns
	 * to the sign-in form.
	 *
	 * What is shown comes from `session`, which is a cache of what the endpoint
	 * last said rather than proof of anything. That is fine for a drawer: the
	 * server decides what a request may do, and the worst a stale record can do
	 * here is offer a sign-out that answers 204 and changes nothing.
	 */

	let busy = $state(false);

	/**
	 * Which sign-out is waiting to be confirmed, and `null` when none is.
	 *
	 * Emptying the device is only safe once the server has what is on it, so the
	 * sync module is asked to flush first. When something cannot be sent, the
	 * choice is the person's: this is the one moment in the application where
	 * carrying on destroys something that exists nowhere else.
	 */
	let confirming = $state<boolean | null>(null);

	async function attemptEnd(everywhere: boolean) {
		if (busy) return;
		busy = true;
		const sent = await sync.flush();
		busy = false;
		if (!sent) {
			confirming = everywhere;
			return;
		}
		await end(everywhere);
	}

	/**
	 * Both sign-outs end the same way. Anything but a connection failure means
	 * the server is not holding this session any more — a 204 because it revoked
	 * it, a 401 because it never had one — so the record goes either way. Only
	 * an unreachable server leaves it in place, because then nothing was asked
	 * and nothing was answered.
	 */
	async function end(everywhere: boolean) {
		confirming = null;
		busy = true;
		const result = everywhere ? await signOutEverywhere() : await signOut();
		busy = false;
		if (!result.ok && result.failure.code === 'unreachable') {
			toast(failureWording(result.failure));
			return;
		}
		session.forget();
		// After the session, so nothing can start a fresh sync against a record
		// that is about to be removed.
		sync.forget();
		toast(result.ok && everywhere ? 'Signed out everywhere.' : 'Signed out.');
	}
</script>

<div class="mt-auto flex flex-col gap-1 px-4 pt-4 pb-3">
	<SectionLabel>Account</SectionLabel>
	{#if session.signedIn && session.account}
		<p class="mt-1 truncate text-sm font-medium">{session.account.displayName}</p>
		<p class="text-muted-foreground truncate text-xs">@{session.account.username}</p>
		{#if confirming === null}
			<Button
				variant="outline"
				size="sm"
				class="mt-3"
				disabled={busy}
				onclick={() => attemptEnd(false)}
			>
				Sign out
			</Button>
			<Button variant="quiet" size="sm" disabled={busy} onclick={() => attemptEnd(true)}>
				Sign out everywhere
			</Button>
		{:else}
			<p class="text-muted-foreground mt-3 text-xs" role="alert">
				Some of what you logged has not reached the server yet. Signing out clears this device.
			</p>
			<Button
				variant="outline"
				size="sm"
				class="mt-2"
				disabled={busy}
				onclick={() => end(confirming ?? false)}
			>
				Sign out anyway
			</Button>
			<Button variant="quiet" size="sm" disabled={busy} onclick={() => (confirming = null)}>
				Keep them
			</Button>
		{/if}
	{/if}
</div>

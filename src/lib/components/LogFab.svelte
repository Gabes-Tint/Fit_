<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/ui/Button.svelte';

	let { onlog }: { onlog: () => void } = $props();

	// Today already has its own "Log food" button, on the Energy card, so the
	// floating one would be a second control with the same accessible name on
	// the one screen that carries both — everywhere else it is still the only way in.
	const onTodayRoute = $derived(page.url.pathname === resolve('/'));
</script>

<!--
	Fixed and column-aligned the way `SyncStatusBadge` is, but pinned to the
	bottom of the viewport and right-aligned within the app column rather than
	centred: this is a floating action button, not a status line. `z-20` sits
	below `SyncStatusBadge` (`z-30`) and `TopBar` (`z-40`), and well below the
	`Sheet` and `SideNav` overlays (`z-50`) so an open sheet or drawer covers it
	rather than the button poking through on top.
-->
{#if !onTodayRoute}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
	>
		<div class="flex w-full max-w-lg justify-end">
			<Button
				size="icon-round"
				class="shadow-border pointer-events-auto size-14 shadow-lg"
				onclick={onlog}
				aria-label="Log food"
			>
				<Plus class="size-6" />
			</Button>
		</div>
	</div>
{/if}

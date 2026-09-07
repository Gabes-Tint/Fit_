<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import { browser } from '$app/environment';
	import { DEMOS } from '$lib/domain/exercise-catalog';
	import { formCues } from '$lib/domain/exercises';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';

	// The demo clip is a placeholder that says so: a fake player is worse than an honest gap.
	// Which movements have a real clip lives in the exercise catalog's DEMOS map, not here —
	// a name with no entry there keeps the honest gap.
	let {
		open = $bindable(false),
		name,
		onclose
	}: { open?: boolean; name: string; onclose: () => void } = $props();

	const cues = $derived(formCues(name));
	const demo = $derived(DEMOS[name]);

	// WCAG 2.2.2: motion that starts on its own, runs past five seconds, and sits
	// beside other content needs a way to stop it. Someone who has asked their
	// system for reduced motion gets no autoplay at all; everyone else still gets
	// the same tap/keyboard toggle, since it is the only visible way to pause.
	const prefersReducedMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let videoEl: HTMLVideoElement | undefined = $state();

	function toggleDemo() {
		if (!videoEl) return;
		if (videoEl.paused) void videoEl.play();
		else videoEl.pause();
	}

	function onDemoKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		toggleDemo();
	}
</script>

<Modal bind:open title={name} description="Form check">
	{#if demo}
		<!--
			Modal only mounts this markup once `open` is true (bits-ui's Dialog.Content
			renders nothing while closed — see the "shows nothing until it is opened"
			spec), so this <video> and its src never enter the DOM, and the clip never
			loads, until the sheet is actually opened. preload="none" keeps it that way
			even if that assumption ever changes.

			Autoplay, loop and no visible controls are the request; the tap/keyboard
			toggle below is what makes that legal under WCAG 2.2.2 (Pause, Stop,
			Hide), and reduced-motion visitors get the same toggle instead of an
			autostart.
		-->
		<video
			bind:this={videoEl}
			class="bg-secondary focus-visible:ring-ring ring-offset-background mt-4 aspect-square w-full rounded-2xl object-cover focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
			src={demo.src}
			preload="none"
			playsinline
			muted
			loop
			autoplay={!prefersReducedMotion}
			role="button"
			tabindex={0}
			aria-label={`${demo.description} Tap or press Enter to pause or play.`}
			onclick={toggleDemo}
			onkeydown={onDemoKeydown}
		>
			<p>{demo.description}</p>
		</video>
	{:else}
		<div
			class="bg-secondary text-foreground/70 mt-4 flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl"
		>
			<Play class="size-6" />
			<p class="text-xs">A demonstration clip belongs here</p>
		</div>
	{/if}
	<ul class="mt-4 flex flex-col gap-2.5">
		<!-- Keyed by position: a repeated cue would be a duplicate key, and nothing reorders this list. -->
		{#each cues as cue, i (i)}
			<li class="flex items-start gap-2.5">
				<span
					class="bg-accent text-accent-foreground tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-lg text-xs font-medium"
				>
					{i + 1}
				</span>
				<span class="text-sm leading-snug">{cue}</span>
			</li>
		{/each}
	</ul>
	<Button class="mt-5 w-full" onclick={onclose}>Got it</Button>
</Modal>

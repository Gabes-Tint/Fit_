<script lang="ts">
	import ScanBarcode from '@lucide/svelte/icons/scan-barcode';
	import { onDestroy, onMount } from 'svelte';
	import { lookupBarcode, type BarcodeOutcome } from '$lib/catalog/barcode-lookup';
	import type { Food } from '$lib/domain/types';
	import { createBarcodeReader, type BarcodeReader } from '$lib/ui/barcode-reader';
	import { startCamera, type CameraFailure } from '$lib/ui/camera';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';

	// The camera opens on mount, and this pane only mounts when the Scan tab is
	// tapped: that is what makes the permission prompt happen at the first scan
	// rather than at launch, and declining it leaves the rest of logging alone.
	let { onpick, onsearch }: { onpick: (food: Food) => void; onsearch: () => void } = $props();

	type Phase = 'opening' | 'scanning' | 'blocked' | 'unreadable' | 'looking' | 'answered';

	/** Four frames a second: fast enough to feel instant, cheap enough for a phone. */
	const SCAN_INTERVAL_MS = 250;

	const TROUBLE: Record<CameraFailure, string> = {
		unsupported: 'No camera answered here. Type the digits and it will still be looked up.',
		denied:
			'Camera access was declined. Type the digits instead, or allow the camera in your settings.',
		unavailable: 'The camera is busy. Type the digits, or close whatever else is using it.'
	};

	let phase = $state<Phase>('opening');
	let failure = $state<CameraFailure>('unavailable');
	let outcome = $state<BarcodeOutcome | null>(null);
	let stream = $state<MediaStream | null>(null);
	// Read in the template through the viewfinder attachment, so it is state.
	let reader = $state<BarcodeReader | null>(null);
	let typed = $state('');
	/**
	 * Foods a duplicated barcode named. Held apart from `outcome` so the markup
	 * has one list to render and no narrowing to repeat.
	 */
	let choices = $state<Food[]>([]);

	let stopStream: (() => void) | null = null;
	// One detection at a time: a frame arriving mid-read would queue behind it.
	let reading = false;

	/** What a lookup that did not simply answer with one food has to say. */
	function said(answer: BarcodeOutcome): string {
		if (answer.kind === 'known') return 'That barcode names more than one food. Which is it?';
		if (answer.kind === 'unknown')
			return `Nothing in the catalog carries ${answer.code}. Search for it by name and log it that way.`;
		if (answer.kind === 'signed-out')
			return 'Sign in to reach the food catalog. Looking a barcode up needs it, so there is nothing to check the code against without an account.';
		if (answer.kind === 'unreachable')
			return 'The full catalog is out of reach right now. Search by name, or try the scan again in a moment.';
		return 'That isn’t a barcode. A barcode is 8 to 14 digits.';
	}

	// One line of prose for every state but the viewfinder, so the markup does
	// not carry a branch and a paragraph for each.
	const notice = $derived.by(() => {
		if (phase === 'opening') return 'Opening the camera…';
		if (phase === 'looking') return 'Looking that barcode up…';
		// Chromium has `BarcodeDetector` and Safari does not.
		if (phase === 'unreadable')
			return 'This device can’t read a barcode with its camera. Type the digits instead.';
		if (phase === 'blocked') return TROUBLE[failure];
		return outcome === null ? '' : said(outcome);
	});

	const canRetry = $derived(phase === 'blocked' || phase === 'answered');

	function release() {
		stopStream?.();
		stopStream = null;
		stream = null;
	}

	async function resolveCode(code: string) {
		release();
		phase = 'looking';
		const answer = await lookupBarcode(code);
		// One food and no doubt about it: propose it and let the sheet take over.
		if (answer.kind === 'known' && !answer.ambiguous && answer.foods[0]) {
			onpick(answer.foods[0]);
			return;
		}
		choices = answer.kind === 'known' ? answer.foods : [];
		outcome = answer;
		phase = 'answered';
	}

	async function readFrame(node: HTMLVideoElement, current: BarcodeReader) {
		if (reading || phase !== 'scanning') return;
		reading = true;
		try {
			const code = await current.read(node);
			if (code !== null && phase === 'scanning') await resolveCode(code);
		} finally {
			reading = false;
		}
	}

	// An attachment, not bind:this: the timer and the stream are undone the
	// moment the viewfinder leaves, whichever way the pane is left.
	function viewfinder(source: MediaStream | null, current: BarcodeReader | null) {
		return (node: HTMLVideoElement) => {
			node.srcObject = source;
			const timer =
				current === null
					? null
					: setInterval(() => void readFrame(node, current), SCAN_INTERVAL_MS);
			return () => {
				if (timer !== null) clearInterval(timer);
				node.srcObject = null;
			};
		};
	}

	async function openCamera() {
		outcome = null;
		choices = [];
		phase = 'opening';
		// No detector means the camera would only ever show a picture of a
		// barcode, so it is not opened and no permission is asked for.
		if (reader === null) {
			phase = 'unreadable';
			return;
		}
		const opened = await startCamera();
		if (!opened.ok) {
			failure = opened.reason;
			phase = 'blocked';
			return;
		}
		stopStream = opened.stop;
		stream = opened.stream;
		phase = 'scanning';
	}

	function submitTyped(event: SubmitEvent) {
		event.preventDefault();
		void resolveCode(typed);
	}

	onMount(() => {
		reader = createBarcodeReader();
		void openCamera();
	});
	onDestroy(release);
</script>

<div class="bg-background flex flex-col items-center gap-3 rounded-3xl px-4 py-6 text-center">
	{#if phase === 'scanning'}
		<video
			{@attach viewfinder(stream, reader)}
			autoplay
			playsinline
			muted
			aria-label="Barcode viewfinder"
			class="bg-secondary aspect-[4/3] w-full max-w-xs rounded-2xl object-cover"
		></video>
		<p class="text-muted-foreground max-w-xs text-sm">Hold the barcode inside the frame.</p>
	{:else}
		<ScanBarcode class="text-primary size-8" />
		<p class="text-muted-foreground max-w-xs text-sm">{notice}</p>

		{#if choices.length > 0}
			<ul class="flex w-full max-w-xs flex-col gap-1">
				{#each choices as food (food.id)}
					<li>
						<button
							type="button"
							onclick={() => onpick(food)}
							class="bg-card hover:bg-secondary w-full rounded-2xl px-3 py-3 text-left transition-colors"
						>
							<p class="truncate font-medium">{food.name}</p>
							<p class="text-muted-foreground truncate text-xs">
								{food.brand ? `${food.brand} · ` : ''}{food.servingLabel} · {food.kcal} kcal
							</p>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if canRetry}
			<div class="flex gap-2">
				<Button variant="secondary" onclick={() => void openCamera()}>Scan again</Button>
				{#if phase === 'answered'}
					<Button variant="quiet" onclick={onsearch}>Search by name</Button>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Typing the digits is never taken away: it is the way through a refused
	     camera, an engine with no detector, and a barcode nothing recognizes. -->
	<form class="flex w-full max-w-xs gap-2" onsubmit={submitTyped}>
		<Input
			bind:value={typed}
			inputmode="numeric"
			placeholder="Type the digits"
			aria-label="Barcode digits"
		/>
		<Button type="submit" disabled={typed.trim() === ''}>Look it up</Button>
	</form>
</div>

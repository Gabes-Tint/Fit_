<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import ImageUp from '@lucide/svelte/icons/image-up';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Mic from '@lucide/svelte/icons/mic';
	import ScanBarcode from '@lucide/svelte/icons/scan-barcode';
	import Search from '@lucide/svelte/icons/search';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { resolveFoodNames } from '$lib/catalog/food-resolve';
	import { MAX_QUERIES } from '$lib/domain/resolve-limits';
	import { foodProposal } from '$lib/domain/food-proposal';
	import { logFromCatalogFood } from '$lib/domain/log-entry';
	import { guessMeal, parseLocalText, type ParsedChunk } from '$lib/domain/parse-text';
	import { defaultServings, servingStep } from '$lib/domain/profile';
	import { matchToFood, type QuantifiedItem } from '$lib/domain/quantity';
	import { nextProposalId, type Proposal } from '$lib/domain/proposal-id';
	import type { PhotoFood } from '$lib/photo/photo-log';
	import type { Food, Meal } from '$lib/domain/types';
	import { MEALS } from '$lib/domain/types';
	import { usualServings } from '$lib/domain/usual-portion';
	import { todayISO } from '$lib/domain/utils';
	import { logUi, type LogTab } from '$lib/state/log-ui.svelte';
	import { tend } from '$lib/state/tend.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import BarcodeScan from './BarcodeScan.svelte';
	import FoodSearch from './FoodSearch.svelte';
	import PhotoCapture from './PhotoCapture.svelte';
	import ProposalRow from './ProposalRow.svelte';
	import RecentFoodList from './RecentFoodList.svelte';
	import { startDictation, type Dictation } from '$lib/ui/dictation';

	const TABS = [
		{ id: 'search', icon: Search, label: 'Search' },
		{ id: 'type', icon: Keyboard, label: 'Type' },
		{ id: 'photo', icon: Camera, label: 'Photo' },
		{ id: 'upload', icon: ImageUp, label: 'Upload' },
		{ id: 'voice', icon: Mic, label: 'Voice' },
		{ id: 'scan', icon: ScanBarcode, label: 'Scan' }
	] as const satisfies readonly { id: LogTab; icon: unknown; label: string }[];

	let text = $state('');
	let meal = $state<Meal>(guessMeal());
	let listening = $state(false);
	let proposals = $state<Proposal[]>([]);
	let matchId = $state<string | null>(null);
	/**
	 * Whether the server is still naming the foods of the sentence just
	 * submitted. It says so on the Type tab rather than disabling `Parse`: a
	 * second submission is allowed to overtake the first, and `textRun` is what
	 * makes the newer one win.
	 */
	let resolving = $state(false);
	/**
	 * Which submission the list belongs to. A second `Parse` while the first is
	 * still in flight wins outright: the answer to a sentence nobody is looking
	 * at any more must never land on the list.
	 */
	let textRun = 0;
	let dictation: Dictation | null = null;
	/**
	 * Foods the server catalog answered with, by the id `propose` put on the
	 * proposal. The catalog's rows live on the server, so `commit` has to resolve
	 * them from here or it would drop what the person just chose -- which, since
	 * #146, is every result search returns.
	 */
	let fromCatalog = $state<Record<string, Food>>({});
	/**
	 * The proposals a photo put here, by id. `commit` reads it to file them under
	 * the `photo` source instead of `text`; a set rather than a field on the
	 * proposal, because `matchToFood` rebuilds a proposal from its own fields and
	 * would drop anything it does not know about.
	 */
	let fromPhoto = $state<Set<string>>(new Set());
	/**
	 * A portion chosen for one proposal, by the proposal's own id rather than
	 * its `foodId`. Two proposals can point at the same catalog food -- eggs
	 * added twice in one sentence -- and each has to be free to pick its own
	 * serving without the other silently changing underneath it, which keying
	 * this by `foodId` the way `fromCatalog` does would not give.
	 */
	let portioned = $state<Record<string, Food>>({});

	/** `portioned` with one proposal's chosen serving forgotten. */
	function forgetProposal(record: Record<string, Food>, id: string): Record<string, Food> {
		return Object.fromEntries(Object.entries(record).filter(([entryId]) => entryId !== id));
	}

	const step = $derived(servingStep(tend.profile));
	const servings = $derived(defaultServings(tend.profile));

	function reset() {
		proposals = [];
		text = '';
		matchId = null;
		listening = false;
		resolving = false;
		// Retires anything in flight, so its answer cannot arrive into a sheet
		// that has been closed and reopened for something else.
		textRun += 1;
		fromCatalog = {};
		fromPhoto = new Set();
		portioned = {};
		logUi.tab = 'type';
	}

	function close() {
		logUi.open = false;
		reset();
	}

	$effect(() => {
		if (logUi.open) meal = logUi.meal ?? guessMeal();
	});

	/**
	 * The amount a row for this food opens at: what this person last logged of
	 * it, and the profile's own default for a food they have never logged (#159).
	 * Read out of the log rather than out of a remembered-portions table, so
	 * there is nothing to keep in step with the log and nothing to prune.
	 *
	 * Only this path takes it. A typed sentence carries a quantity the person
	 * said out loud, and `foodProposal` resolving "two eggs" to something else
	 * would be overruling them.
	 */
	function opensAt(food: Food): number {
		return usualServings(tend.profile?.log ?? [], food) ?? servings;
	}

	function propose(food: Food, confidence: number) {
		proposals = [
			...proposals,
			{
				id: nextProposalId(),
				foodId: food.id,
				query: food.name,
				name: food.name,
				servings: opensAt(food),
				meal,
				confidence
			}
		];
		logUi.tab = 'type';
	}

	/**
	 * How sure a proposal built from typed words is.
	 *
	 * Above a photo, which is a guess about a picture, and below a search or a
	 * scan, where the person picked the row themselves. Here the words are
	 * theirs and the row is the catalog's ranking of them, so the number is what
	 * tells them to read the name before they tap.
	 */
	const TEXT_CONFIDENCE = 0.8;

	/** What a row says when there was no answer to be had about it. */
	const NOTES = {
		signedOut: 'Sign in to match this',
		offline: 'Matching needs the server',
		overflow: 'Too many items to match at once'
	} as const;

	/** A row for text nothing was matched to, saying why rather than just failing. */
	function unmatched(chunk: ParsedChunk, note: string): Proposal {
		return foodProposal({ ...chunk, food: null, confidence: 0, note });
	}

	/**
	 * Take a typed sentence: quantities here, food names from the server.
	 *
	 * The device splits the sentence and reads the quantities, which is
	 * arithmetic on the words. Naming the food is the catalog's job and needs
	 * one round trip for the whole sentence. Nothing is matched without it, so
	 * every outcome that is not an answer leaves the rows on screen with their
	 * own words and their own quantity, for the person to match by hand or to
	 * retry once they are back.
	 */
	async function runText(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return;
		const chunks = parseLocalText(trimmed, meal);
		if (chunks.length === 0) return;
		const run = ++textRun;
		// Past the cap the server refuses the whole body, so the rest are kept as
		// rows to match by hand rather than costing everything else its answer.
		const asked = chunks.slice(0, MAX_QUERIES);
		const overflow = chunks.slice(MAX_QUERIES);
		resolving = true;
		const outcome = await resolveFoodNames(asked.map((chunk) => chunk.query));
		if (run !== textRun) return;
		resolving = false;
		matchId = null;

		if (outcome.kind !== 'resolved') {
			const signedOut = outcome.kind === 'signed-out';
			proposals = chunks.map((chunk) =>
				unmatched(chunk, signedOut ? NOTES.signedOut : NOTES.offline)
			);
			toast(
				signedOut
					? 'Sign in to match what you typed. You can still pick from Search.'
					: 'Matching needs the server. You can pick from Search when you’re back online.'
			);
			return;
		}

		const named = outcome.items;
		const matched = asked.map((chunk, index) => {
			const food = named[index]?.food ?? null;
			if (food) remember(food);
			return foodProposal({ ...chunk, food, confidence: food ? TEXT_CONFIDENCE : 0 });
		});
		proposals = [...matched, ...overflow.map((chunk) => unmatched(chunk, NOTES.overflow))];
		if (overflow.length > 0) {
			toast(`Only the first ${MAX_QUERIES} items were matched — match the rest by hand.`);
		} else if (matched.some((proposal) => proposal.foodId === null)) {
			toast('Some items need a catalog match — tap "Match to catalog".');
		}
	}

	function toggleVoice() {
		if (listening) {
			dictation?.stop();
			listening = false;
			return;
		}
		dictation = startDictation({
			onresult: (said) => {
				text = said;
				listening = false;
				void runText(said);
			},
			onerror: () => {
				listening = false;
				toast('Didn’t catch that.');
			},
			onend: () => (listening = false)
		});
		if (!dictation) {
			toast('Voice typing isn’t available here. Type it instead.');
			return;
		}
		listening = true;
	}

	/**
	 * Every food a proposal can name comes from the server catalog, and its rows
	 * are not on the device -- so the one that was matched is held here until the
	 * sheet commits, or its nutrition is gone by the time it is needed.
	 */
	function remember(food: Food) {
		fromCatalog = { ...fromCatalog, [food.id]: food };
	}

	function pickFood(food: Food) {
		remember(food);
		propose(food, 1);
	}

	/**
	 * The `+` on a search result row (FoodSearch.svelte): log it now, at the
	 * sheet's current servings and meal, with no proposal in between. MFP does
	 * exactly this -- `+` logs, tapping the name opens the detail -- and it is
	 * the search-tab twin of a one-tap re-log from `RecentFoodList`, which is
	 * why both end in the same toast-and-undo.
	 */
	function logDirect(food: Food) {
		const item = logFromCatalogFood(food, { servings, meal, date: todayISO(), source: 'manual' });
		tend.addLogItems([item]);
		toast(`Logged ${food.name} to ${meal}.`, {
			action: { label: 'Undo', onClick: () => tend.removeLog(item.id) }
		});
	}

	/**
	 * How sure a proposal read off a photo is. Lower than a scan or a search,
	 * which are the person naming the food themselves, and lower than a parsed
	 * line, which is their own words: this one is a guess about a picture, and
	 * the number is what tells them to look before they tap.
	 */
	const PHOTO_CONFIDENCE = 0.6;

	/**
	 * One proposal per food the photo held, built the same way a typed one is:
	 * `food-proposal.ts` carries the weight the model estimated as the row's own
	 * quantity rather than converting it here, so a photo and a sentence resolve
	 * their servings through one function. A food the catalog could not match
	 * keeps its label and its estimate and arrives unmatched, so the person sees
	 * what was skipped rather than a shorter list than the photo held.
	 */
	function photoProposal(found: PhotoFood): Proposal {
		if (found.food) remember(found.food);
		return foodProposal({
			query: found.label,
			food: found.food,
			quantity: { amount: found.grams, unit: 'g', kind: 'mass' },
			meal,
			confidence: PHOTO_CONFIDENCE
		});
	}

	/** Take what the photo was read as, and leave the person on the list to correct. */
	function addPhotoFoods(foods: PhotoFood[]) {
		const added = foods.map(photoProposal);
		// Appended, not assigned: whatever was already parsed or picked is still
		// waiting to be committed, and a photo is another way of adding to it.
		proposals = [...proposals, ...added];
		fromPhoto = new Set([...fromPhoto, ...added.map((p) => p.id)]);
		matchId = null;
		logUi.tab = 'type';
		toast(`Found ${added.length} ${added.length === 1 ? 'food' : 'foods'} in the photo.`);
	}

	function commit() {
		const date = todayISO();
		// Drop unmatched proposals: with no catalog food there is no nutrition to log.
		const items = proposals.flatMap((p) => {
			if (!p.foodId) return [];
			const context = {
				servings: p.servings,
				meal: p.meal,
				date,
				source: fromPhoto.has(p.id) ? ('photo' as const) : ('text' as const),
				note: p.note
			};
			// A chosen portion, when there is one, is what got resolved on screen
			// and is what must be logged -- falling back to `fromCatalog` here
			// would commit the food's default serving after the person picked
			// a different one.
			const catalogFood = portioned[p.id] ?? fromCatalog[p.foodId];
			return catalogFood ? [logFromCatalogFood(catalogFood, context)] : [];
		});
		if (!items.length) {
			toast('Match each item to a catalog food first.');
			return;
		}
		tend.addLogItems(items);
		toast(`Added ${items.length} ${items.length === 1 ? 'item' : 'items'}.`);
		// The sheet closes on the next line, taking the skipped rows with it, so
		// this is the only moment they can be named. Saying "added 2" and quietly
		// dropping the third is the sheet deciding something on the person's
		// behalf and not telling them.
		const skipped = proposals.length - items.length;
		if (skipped > 0) {
			toast(
				`${skipped} ${skipped === 1 ? 'item' : 'items'} had no catalog food and ${
					skipped === 1 ? 'was' : 'were'
				} not logged — match each item to a catalog food first.`
			);
		}
		close();
	}
</script>

<Sheet
	bind:open={
		() => logUi.open,
		(v) => {
			if (v) logUi.open = true;
			else close();
		}
	}
	title="Log"
	description="Tend proposes. You correct in one tap."
	tall
	onclose={close}
>
	<div class="flex shrink-0 gap-1 px-5 pt-4">
		{#each TABS as t (t.id)}
			{@const Icon = t.icon}
			<ToggleButton
				pressed={logUi.tab === t.id}
				onclick={() => (logUi.tab = t.id)}
				resting="bg-secondary text-muted-foreground"
				class="flex h-11 flex-1 flex-col items-center justify-center rounded-xl text-xs font-medium"
			>
				<Icon class="size-4" />
				{t.label}
			</ToggleButton>
		{/each}
	</div>

	<div data-testid="log-scroll" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-8">
		<div class="mb-3 flex gap-1">
			{#each MEALS as m (m)}
				<ToggleButton
					pressed={meal === m}
					onclick={() => (meal = m)}
					resting="bg-secondary text-muted-foreground"
					class="h-8 flex-1 rounded-full text-xs capitalize"
				>
					{m}
				</ToggleButton>
			{/each}
		</div>

		{#if logUi.tab === 'type'}
			<div class="flex flex-col gap-3">
				<Textarea
					bind:value={text}
					class="min-h-24"
					placeholder="two eggs, toast, black coffee"
					rows={3}
					aria-label="What you ate"
				/>
				<Button onclick={() => void runText(text)} disabled={!text.trim()}>Parse</Button>
				{#if resolving}
					<p class="text-muted-foreground px-1 text-xs">Matching against the full catalog…</p>
				{/if}
			</div>
		{:else if logUi.tab === 'photo'}
			<PhotoCapture
				route="camera"
				{meal}
				ontype={() => (logUi.tab = 'type')}
				onfoods={addPhotoFoods}
			/>
		{:else if logUi.tab === 'upload'}
			<PhotoCapture
				route="file"
				{meal}
				ontype={() => (logUi.tab = 'type')}
				onfoods={addPhotoFoods}
			/>
		{:else if logUi.tab === 'voice'}
			<div class="bg-background flex flex-col items-center gap-3 rounded-3xl px-4 py-8 text-center">
				<Mic class="size-8 {listening ? 'text-primary' : 'text-muted-foreground'}" />
				<p class="text-muted-foreground max-w-xs text-sm">
					Say what you ate. It goes through the same parser as typing.
				</p>
				<Button onclick={toggleVoice} variant={listening ? 'secondary' : 'default'}>
					{listening ? 'Listening — tap to stop' : 'Start listening'}
				</Button>
			</div>
		{:else if logUi.tab === 'scan'}
			<BarcodeScan onpick={pickFood} onsearch={() => (logUi.tab = 'search')} />
		{:else}
			<RecentFoodList {meal} />
			<FoodSearch onpick={pickFood} ondirectlog={logDirect} />
		{/if}

		{#if proposals.length > 0}
			<div class="mt-5">
				<div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
					<Sparkles class="size-3.5" />
					Proposed — tap to correct
				</div>
				<ul class="flex flex-col gap-2">
					{#each proposals as p (p.id)}
						<ProposalRow
							item={p}
							{step}
							matching={matchId === p.id}
							resolved={portioned[p.id] ?? (p.foodId ? fromCatalog[p.foodId] : undefined)}
							onmatch={() => (matchId = matchId === p.id ? null : p.id)}
							onpickmatch={(food: Food) => {
								// Matching a proposal reaches the same search, so the food
								// arrives here too and has to be remembered the same way.
								remember(food);
								proposals = proposals.map((x) =>
									// The note is dropped: the only one anything sets is “not found in
									// the catalog”, which this tap has just made untrue.
									x.id === p.id ? { ...matchToFood(x, food), id: x.id, note: undefined } : x
								);
								// A new match points this row at a different food than whatever
								// portion was chosen before -- carrying that choice forward
								// would log a weight that belongs to a food that is no longer here.
								portioned = forgetProposal(portioned, p.id);
								matchId = null;
							}}
							onchange={(next: QuantifiedItem) =>
								(proposals = proposals.map((x) => (x.id === p.id ? { ...next, id: x.id } : x)))}
							onportion={(food: Food) => (portioned = { ...portioned, [p.id]: food })}
							onremove={() => {
								proposals = proposals.filter((x) => x.id !== p.id);
								portioned = forgetProposal(portioned, p.id);
								if (matchId === p.id) matchId = null;
							}}
						/>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	{#if proposals.length > 0}
		<div
			data-testid="log-footer"
			class="border-border shrink-0 border-t px-5 pt-3 pb-3 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
		>
			<Button class="w-full" size="lg" onclick={commit}>Add to today</Button>
		</div>
	{/if}
</Sheet>

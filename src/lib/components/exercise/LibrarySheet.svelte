<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import ExercisePickRow from '$lib/components/exercise/ExercisePickRow.svelte';
	import FormCheckModal from '$lib/components/exercise/FormCheckModal.svelte';
	import { searchLibrary } from '$lib/domain/exercises';
	import { MUSCLE_GROUPS, type MuscleGroup } from '$lib/domain/types';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import ToggleButton from '$lib/ui/ToggleButton.svelte';

	// Selection accumulates: building a push day is one trip through the list, not six.
	let {
		open = $bindable(false),
		routineName,
		taken,
		onadd,
		onclose
	}: {
		open?: boolean;
		routineName: string;
		/** What the routine already prescribes; never offered a second time. */
		taken: string[];
		onadd: (names: string[]) => void;
		onclose: () => void;
	} = $props();

	const FILTERS: { label: string; group: MuscleGroup | null }[] = [
		{ label: 'All', group: null },
		...MUSCLE_GROUPS.map((group) => ({ label: group, group }))
	];

	let group = $state<MuscleGroup | null>(null);
	let query = $state('');
	let picked = $state<string[]>([]);
	let formOpen = $state(false);
	let formName = $state('');

	// The search narrows what is offered, never what is already chosen: a pick
	// made before typing a query must not fall out of `picked` just because the
	// row that made it is no longer on screen. `picked` and `items` are read
	// independently everywhere below, on purpose.
	const items = $derived(searchLibrary(query, group).filter((e) => !taken.includes(e.name)));
	const cta = $derived(
		picked.length === 0 ? 'Pick exercises to add' : `Add ${picked.length} to the routine`
	);

	/**
	 * Why the list is empty, when it is. A query that matches nothing is a
	 * different fact from a group that is fully taken, and MFP's picker never
	 * has to say either — it always has more rows than fit on screen. This
	 * library is local and finite, so both are worth a sentence rather than a
	 * blank rectangle.
	 */
	const empty = $derived.by(() => {
		if (items.length > 0) return '';
		if (query.trim() !== '') return `Nothing in the library matches "${query.trim()}".`;
		return 'Everything the library has for this is already on the routine.';
	});

	function typed(value: string) {
		query = value;
	}

	function toggle(name: string) {
		picked = picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name];
	}

	function showForm(name: string) {
		formName = name;
		formOpen = true;
	}

	/**
	 * Leaving the sheet drops the selection; a half-made pick is not a draft.
	 * The query is dropped with it for the same reason: reopening the sheet is
	 * a fresh trip through the library, not a resumed search.
	 */
	function close() {
		picked = [];
		query = '';
		onclose();
	}

	function add() {
		onadd(picked);
		close();
	}
</script>

<Sheet bind:open title="Library" description="Adding to {routineName}" onclose={close}>
	<div class="px-5 pt-3">
		<div class="relative">
			<Search
				class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
			/>
			<Input
				bind:value={() => query, typed}
				placeholder="Search exercises"
				aria-label="Search exercises"
				class="pl-9"
			/>
		</div>
	</div>
	<div class="flex flex-wrap gap-1.5 px-5 pt-3">
		{#each FILTERS as filter (filter.label)}
			<ToggleButton
				pressed={group === filter.group}
				onclick={() => (group = filter.group)}
				resting="text-muted-foreground"
				class="border-border h-8 rounded-full border px-3 text-xs"
			>
				{filter.label}
			</ToggleButton>
		{/each}
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
		{#each items as item (item.name)}
			<ExercisePickRow
				name={item.name}
				note={item.group}
				selected={picked.includes(item.name)}
				onpick={() => toggle(item.name)}
				onplay={() => showForm(item.name)}
			/>
		{:else}
			<p class="text-muted-foreground px-2 py-8 text-center text-sm">
				{empty}
			</p>
		{/each}
	</div>
	<div class="border-border border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shrink-0">
		<Button class="w-full" size="lg" disabled={picked.length === 0} onclick={add}>{cta}</Button>
	</div>
</Sheet>

<FormCheckModal bind:open={formOpen} name={formName} onclose={() => (formOpen = false)} />

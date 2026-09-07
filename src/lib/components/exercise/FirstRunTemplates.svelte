<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { ROUTINE_TEMPLATES } from '$lib/domain/exercise-catalog';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let {
		onpick,
		onopen
	}: {
		onpick: (templateId: string) => void;
		/** Opens the routine builder instead of a template. */
		onopen: () => void;
	} = $props();
</script>

<div class="flex flex-col gap-4 pb-10">
	<PageHeader kicker="Movement, not penance" title="Nothing here yet">
		Pick something close enough to start with. You can change every exercise, set and rep
		afterwards.
	</PageHeader>

	<div class="flex flex-col gap-2.5">
		{#each ROUTINE_TEMPLATES as template (template.id)}
			<button
				type="button"
				onclick={() => onpick(template.id)}
				class="bg-card w-full rounded-3xl p-4 text-left shadow-border"
			>
				<span class="flex items-center gap-3">
					<span
						class="bg-accent text-accent-foreground font-display flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg"
					>
						{template.badge}
					</span>
					<span class="min-w-0 flex-1">
						<span class="font-display block text-lg tracking-tight">{template.name}</span>
						<span class="text-muted-foreground mt-0.5 block text-xs">{template.sub}</span>
					</span>
					<ChevronRight class="text-muted-foreground size-4 shrink-0" />
				</span>
				<span class="text-muted-foreground mt-3 block text-xs leading-relaxed">{template.body}</span
				>
			</button>
		{/each}
	</div>

	<button
		type="button"
		onclick={onopen}
		class="border-border text-muted-foreground h-12 w-full rounded-2xl border border-dashed text-sm"
	>
		Build one from scratch
	</button>
</div>

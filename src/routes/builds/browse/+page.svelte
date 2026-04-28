<script lang="ts">
	import BuildCard from '$lib/components/BuildCard.svelte';
	import { toBuildCardData } from '$lib/utils/build-card';

	let { data } = $props();

	const cards = $derived(toBuildCardData(data.builds));
	const hasPrev = $derived(data.page > 1);
	const hasNext = $derived(data.page < data.totalPages);
	const rangeStart = $derived(
		data.totalCount === 0 ? 0 : (data.page - 1) * data.pageSize + 1
	);
	const rangeEnd = $derived(Math.min(data.page * data.pageSize, data.totalCount));
</script>

<svelte:head>
	<title>Tyr HQ | Browse Builds</title>
</svelte:head>

<section class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-10 pt-8 md:px-6 md:pb-12">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">Community Loadouts</div>
			<h1 class="tyr-section-title">Browse Builds</h1>
		</div>
		<a href="/tools/builds" class="hud-cta px-4 py-3">New Build</a>
	</div>

	{#if data.totalCount === 0}
		<div class="hud-panel p-8 text-center">
			<p class="text-[var(--hud-muted)]">No public builds yet.</p>
			<a
				href="/tools/builds"
				class="mt-4 inline-block text-sm text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
			>
				Open the Build Planner to publish the first one
			</a>
		</div>
	{:else}
		<div
			class="flex flex-wrap items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			<span>
				Showing <span class="hud-numeric text-[var(--hud-text)]">{rangeStart}</span>
				&ndash;
				<span class="hud-numeric text-[var(--hud-text)]">{rangeEnd}</span>
				of
				<span class="hud-numeric text-[var(--hud-text)]">{data.totalCount}</span>
			</span>
			<span>
				Page <span class="hud-numeric text-[var(--hud-text)]">{data.page}</span>
				/ <span class="hud-numeric text-[var(--hud-text)]">{data.totalPages}</span>
			</span>
		</div>

		<div class="grid gap-3 xl:grid-cols-2">
			{#each cards as build (build.slug)}
				<BuildCard {build} />
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 pt-2">
			{#if hasPrev}
				<a
					href="?page={data.page - 1}"
					class="hud-cta-ghost px-4 py-3"
					data-sveltekit-preload-data="hover"
				>
					&larr; Previous
				</a>
			{:else}
				<span class="hud-cta-ghost px-4 py-3 opacity-30">&larr; Previous</span>
			{/if}

			{#if hasNext}
				<a
					href="?page={data.page + 1}"
					class="hud-cta-ghost px-4 py-3"
					data-sveltekit-preload-data="hover"
				>
					Next &rarr;
				</a>
			{:else}
				<span class="hud-cta-ghost px-4 py-3 opacity-30">Next &rarr;</span>
			{/if}
		</div>
	{/if}
</section>

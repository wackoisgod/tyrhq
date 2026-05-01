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

	function buildHref({ page, sort }: { page?: number; sort?: 'top' | 'new' } = {}) {
		const nextPage = page ?? 1;
		const nextSort = sort ?? data.sort;
		const params = new URLSearchParams();
		if (nextPage > 1) params.set('page', String(nextPage));
		if (nextSort === 'top') params.set('sort', 'top');
		if (data.vehicleFilter) params.set('vehicle', data.vehicleFilter.slug);
		const qs = params.toString();
		return qs ? `?${qs}` : '?';
	}

	function pageHref(page: number) {
		return buildHref({ page });
	}

	function sortHref(sort: 'top' | 'new') {
		return buildHref({ sort });
	}

	function clearVehicleHref() {
		const params = new URLSearchParams();
		if (data.sort === 'top') params.set('sort', 'top');
		const qs = params.toString();
		return qs ? `?${qs}` : '/builds/browse';
	}
</script>

<svelte:head>
	<title>Tyr HQ | Browse Builds</title>
</svelte:head>

<section class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-10 pt-8 md:px-6 md:pb-12">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">
				Community Loadouts{#if data.vehicleFilter} · {data.vehicleFilter.name}{/if}
			</div>
			<h1 class="tyr-section-title">Browse Builds</h1>
		</div>
		<a href="/tools/builds" class="hud-cta px-4 py-3">New Build</a>
	</div>

	{#if data.vehicleFilter}
		<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
			<span>Filter</span>
			<span
				class="inline-flex items-center gap-2 rounded-sm bg-[var(--hud-panel)] px-3 py-1.5 text-[var(--hud-text)]"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				{data.vehicleFilter.name}
				<a
					href={clearVehicleHref()}
					aria-label="Clear vehicle filter"
					class="text-[var(--hud-muted)] transition hover:text-[#ffd166]"
				>
					&times;
				</a>
			</span>
		</div>
	{:else if data.vehicleNotFound}
		<div
			class="border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-2 text-sm text-[#ffd166]"
		>
			Unknown vehicle "{data.vehicleParam}" — showing all builds.
		</div>
	{/if}

	{#if data.totalCount === 0}
		<div class="hud-panel p-8 text-center">
			<p class="text-[var(--hud-muted)]">
				{#if data.vehicleFilter}
					No public builds for {data.vehicleFilter.name} yet.
				{:else}
					No public builds yet.
				{/if}
			</p>
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
			<div class="flex items-center gap-3">
				<span class="text-[var(--hud-dim)]">Sort</span>
				<div class="flex overflow-hidden rounded-sm" style="box-shadow: var(--hud-surface-ghost);">
					<a
						href={sortHref('top')}
						class="tyr-sort-toggle px-3 py-1.5 transition"
						aria-current={data.sort === 'top' ? 'page' : undefined}
					>
						Top
					</a>
					<a
						href={sortHref('new')}
						class="tyr-sort-toggle px-3 py-1.5 transition"
						aria-current={data.sort === 'new' ? 'page' : undefined}
					>
						New
					</a>
				</div>
				<span>
					Page <span class="hud-numeric text-[var(--hud-text)]">{data.page}</span>
					/ <span class="hud-numeric text-[var(--hud-text)]">{data.totalPages}</span>
				</span>
			</div>
		</div>

		<div class="grid gap-3 xl:grid-cols-2">
			{#each cards as build (build.slug)}
				<BuildCard {build} />
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 pt-2">
			{#if hasPrev}
				<a
					href={pageHref(data.page - 1)}
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
					href={pageHref(data.page + 1)}
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

<style>
	.tyr-sort-toggle {
		background: var(--hud-panel);
		color: var(--hud-muted);
	}
	.tyr-sort-toggle[aria-current='page'] {
		background: var(--hud-teal);
		color: var(--hud-on-gradient);
	}
</style>

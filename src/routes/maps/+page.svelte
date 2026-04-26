<script lang="ts">
	import type { MapSummary } from '$lib/types/game';

	let { data } = $props();

	const groupedMaps = $derived.by(() => {
		const released: MapSummary[] = [];
		const prototype: MapSummary[] = [];
		for (const map of data.maps as MapSummary[]) {
			if (map.status === 'released') released.push(map);
			else prototype.push(map);
		}
		released.sort((a, b) => a.name.localeCompare(b.name));
		prototype.sort((a, b) => a.name.localeCompare(b.name));
		return [
			['Released', released] as const,
			['Prototype', prototype] as const
		].filter(([, items]) => items.length > 0);
	});
</script>

<svelte:head>
	<title>Tyr HQ | Maps</title>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<div class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="hud-telemetry-ribbon">
			<span>Map Intel · Select a battlefield to explore</span>
			<span class="hud-numeric text-[10px] opacity-90">{data.maps.length} maps</span>
		</div>

		<div
			class="bg-[radial-gradient(circle_at_top,rgba(102,218,190,0.06),transparent_40%),linear-gradient(180deg,var(--hud-panel),var(--hud-surface))] px-4 py-6 md:px-6"
		>
			<div class="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<p class="hud-eyebrow tracking-[0.34em]">Map Database</p>
					<h1
						class="hud-headline mt-2 font-[var(--font-display)] text-3xl font-bold text-[var(--hud-text)] md:text-4xl"
					>
						Battlefield Atlas
					</h1>
					<p class="mt-3 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
						Browse the full map roster. Select a map to view the tactical minimap and plan your
						strategy.
					</p>
				</div>
				<p class="hud-numeric shrink-0 text-sm text-[var(--hud-muted)]">
					{data.maps.length} battlefields
				</p>
			</div>

			{#each groupedMaps as [group, maps]}
				<div class="mb-2 mt-6 flex items-center gap-3 first:mt-0">
					<div class="h-2.5 w-2.5 rotate-45 bg-[var(--hud-teal)]/40"></div>
					<h2
						class="font-[var(--font-display)] text-xs uppercase tracking-[0.3em] text-[var(--hud-text)]"
					>
						{group}
					</h2>
					<span class="hud-eyebrow">{maps.length} maps</span>
				</div>

				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each maps as map}
						<a
							href={`/maps/${map.slug}`}
							class="group block overflow-hidden rounded-sm bg-[var(--hud-panel-mid)] shadow-[0_2px_8px_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(69,73,50,0.2)] transition hover:shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.3)] hover:brightness-110"
						>
							<div class="relative aspect-[16/10] overflow-hidden bg-[var(--hud-surface)]">
								<img
									src="/images/maps/lobby/{map.id}.png"
									alt={map.name}
									class="h-full w-full object-cover transition group-hover:scale-105"
								/>
								<div
									class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--hud-panel-mid)] to-transparent"
								></div>
								{#if map.status === 'prototype'}
									<div
										class="absolute right-2 top-2 rounded-sm bg-[var(--hud-surface)]/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-muted)] backdrop-blur-sm"
									>
										Prototype
									</div>
								{/if}
							</div>
							<div class="px-3 py-2.5">
								<div
									class="font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)]"
								>
									{map.name}
								</div>
							</div>
							<div class="h-1 bg-[var(--hud-teal)]"></div>
						</a>
					{/each}
				</div>
			{/each}
		</div>

		<div
			class="flex flex-wrap items-center justify-between gap-3 bg-[var(--hud-panel)] px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)] shadow-[inset_0_2px_0_0_rgba(102,218,190,0.12)] md:px-6"
		>
			<span>Select a map to view the tactical planner</span>
			<span>{data.maps.length} battlefields indexed</span>
		</div>
	</div>
</section>

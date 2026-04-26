<script lang="ts">
	import MapCanvas from './MapCanvas.svelte';

	let { data } = $props();

	const currentUser = $derived(
		data.user
			? {
					id: data.user.id,
					displayName: data.profile?.display_name || data.user.email?.split('@')[0] || 'Pilot'
				}
			: null
	);
</script>

<svelte:head>
	<title>Tyr HQ | {data.map.name}</title>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<!-- Back link -->
	<a
		href="/maps"
		class="hud-link mb-4 inline-flex items-center gap-1.5 text-sm transition hover:text-[var(--hud-lime)]"
	>
		<span class="text-xs">&larr;</span> Back to Map Atlas
	</a>

	<!-- Banner -->
	<div class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="relative h-48 overflow-hidden bg-[var(--hud-surface)] md:h-56">
			<img
				src="/images/maps/lobby/{data.map.id}.png"
				alt={data.map.name}
				class="h-full w-full object-cover object-center"
			/>
			<div
				class="absolute inset-0 bg-gradient-to-t from-[var(--hud-panel)] via-transparent to-transparent"
			></div>
			<div class="absolute inset-x-0 bottom-0 px-6 pb-6">
				<div class="flex items-end gap-3">
					<h1
						class="hud-headline font-[var(--font-display)] text-3xl font-bold text-[var(--hud-text)] md:text-5xl"
					>
						{data.map.name}
					</h1>
					{#if data.map.status === 'prototype'}
						<span
							class="mb-1 rounded-sm bg-[var(--hud-surface)]/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-muted)] backdrop-blur-sm"
						>
							Prototype
						</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Tactical Planner -->
	<div class="mt-6 hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="hud-telemetry-ribbon">
			<span>Tactical Planner · Draw on the minimap to plan strategy</span>
			<span class="hud-numeric text-[10px] opacity-90">{data.map.name}</span>
		</div>

		<div class="bg-[var(--hud-panel)] p-4 md:p-6">
			<div class="mx-auto max-w-[1024px]">
				<MapCanvas
					minimapSrc="/images/maps/minimap/{data.map.id}.png"
					mapName={data.map.name}
					mapSlug={data.map.slug}
					tanks={data.tanks}
					currentUser={currentUser}
				/>
			</div>
		</div>
	</div>

	<!-- Other Maps -->
	{#if data.otherMaps.length > 0}
		<div class="mt-8">
			<div class="mb-3 flex items-center gap-3">
				<div class="h-2.5 w-2.5 rotate-45 bg-[var(--hud-teal)]/40"></div>
				<h2
					class="font-[var(--font-display)] text-xs uppercase tracking-[0.3em] text-[var(--hud-text)]"
				>
					Other Maps
				</h2>
			</div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each data.otherMaps as other}
					<a
						href={`/maps/${other.slug}`}
						class="group block overflow-hidden rounded-sm bg-[var(--hud-panel-mid)] shadow-[0_2px_8px_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(69,73,50,0.2)] transition hover:shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.3)] hover:brightness-110"
					>
						<div class="relative aspect-[16/10] overflow-hidden bg-[var(--hud-surface)]">
							<img
								src="/images/maps/lobby/{other.id}.png"
								alt={other.name}
								class="h-full w-full object-cover transition group-hover:scale-105"
							/>
							<div
								class="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--hud-panel-mid)] to-transparent"
							></div>
						</div>
						<div class="px-3 py-2">
							<div
								class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)]"
							>
								{other.name}
							</div>
						</div>
						<div class="h-1 bg-[var(--hud-teal)]"></div>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</section>

<script lang="ts">
	import MapCanvas from '../../MapCanvas.svelte';

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
	<title>Tyr HQ | {data.map.name} Live Room</title>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
		<a
			href={`/maps/${data.map.slug}`}
			class="hud-link inline-flex items-center gap-1.5 transition hover:text-[var(--hud-lime)]"
		>
			<span class="text-xs">&larr;</span> Solo Planner
		</a>
		<span class="rounded-sm bg-[var(--hud-panel-mid)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
			Live Room
		</span>
	</div>

	<div class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="relative h-48 overflow-hidden bg-[var(--hud-surface)] md:h-56">
			<img
				src="/images/maps/lobby/{data.map.id}.png"
				alt={data.map.name}
				class="h-full w-full object-cover object-center"
			/>
			<div class="absolute inset-0 bg-gradient-to-t from-[var(--hud-panel)] via-transparent to-transparent"></div>
			<div class="absolute inset-x-0 bottom-0 px-6 pb-6">
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<p class="hud-eyebrow text-[10px] tracking-[0.22em] text-[var(--hud-teal)]">
							Shared Map Room
						</p>
						<h1 class="hud-headline font-[var(--font-display)] text-3xl font-bold text-[var(--hud-text)] md:text-5xl">
							{data.room.title}
						</h1>
					</div>
					<span class="mb-1 rounded-sm bg-[var(--hud-surface)]/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-muted)] backdrop-blur-sm">
						{data.map.name}
					</span>
				</div>
			</div>
		</div>
	</div>

	<div class="mt-6 hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="hud-telemetry-ribbon">
			<span>Live Tactical Planner · Shared room with synced edits and presence</span>
			<span class="hud-numeric text-[10px] opacity-90">{data.map.name}</span>
		</div>

		<div class="bg-[var(--hud-panel)] p-4 md:p-6">
			<div class="mx-auto max-w-[1024px]">
				<MapCanvas
					minimapSrc="/images/maps/minimap/{data.map.id}.png"
					mapName={data.map.name}
					mapSlug={data.map.slug}
					tanks={data.tanks}
					availableMaps={data.availableMaps}
					room={data.room}
					currentUser={currentUser}
				/>
			</div>
		</div>
	</div>
</section>

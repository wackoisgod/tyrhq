<script lang="ts">
	import type { Component } from 'svelte';
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import { siteCopy } from '$lib/content/site';
	import { getGameSnapshot } from '$lib/data/game-data';

	type MdModule = { default: Component<Record<string, never>> };
	const heroModules = import.meta.glob<MdModule>('/src/content/home/hero.md', { eager: true });
	const HeroContent = Object.values(heroModules)[0]?.default;

	let { data } = $props();

	const snapshot = getGameSnapshot();
	const componentById = new Map(snapshot.components.map((component) => [component.id, component]));
	const ammoById = new Map(snapshot.ammo.map((ammo) => [ammo.id, ammo]));

	const steamTitle = $derived(
		data.latestSteamPost?.title.replace(/^\[.*?\]\s*/, '').trim() ?? ''
	);

	const heroHeadline = $derived(steamTitle || data.hero.headline);
	const heroSummary = $derived(data.latestSteamPost?.summary ?? data.hero.tagline);
	const heroKicker = $derived(data.latestSteamPost ? 'Latest From Steam' : 'Pilot Briefing');
	const heroDate = $derived(data.latestSteamPost?.date ?? 'Live Companion Site');
	const heroHeadlineLong = $derived(heroHeadline.length > 42);

	const buildsWithVehicle = $derived(
		data.latestBuilds.map((b) => {
			const tank = snapshot.tanks.find((t) => t.id === b.vehicle_id);
			const sel = b.selection;
			const componentIds = (sel?.componentIds ?? []).filter(Boolean);
			const ammoIds = (sel?.ammoIds ?? []).filter((id) => id && id !== 'standard');
			const components = componentIds.map((id) => {
				const component = componentById.get(id);
				return {
					id,
					name: component?.name ?? `Removed component: ${id}`,
					forceFallback: !component
				};
			});
			const ammo = ammoIds.map((id) => {
				const ammoItem = ammoById.get(id);
				return {
					id,
					name: ammoItem?.name ?? id
				};
			});

			return {
				slug: b.slug,
				title: b.title,
				vehicleId: b.vehicle_id,
				vehicleName: tank?.name ?? b.vehicle_id,
				isAlphaProgram: tank?.isWorkInProgress ?? false,
				starCount: b.star_count,
				updatedAt: b.updated_at,
				updatedLabel: new Date(b.updated_at).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric'
				}),
				author:
					(Array.isArray(b.profiles) ? b.profiles[0]?.display_name : b.profiles?.display_name) ??
					'Anonymous',
				components,
				ammo
			};
		})
	);
</script>

<svelte:head>
	<title>Tyr HQ | Home</title>
</svelte:head>

<section class="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-10 pt-8 md:px-6 md:pb-12">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">Frontline Intel</div>
			<h1 class="tyr-section-title">Mission Briefing</h1>
		</div>
	</div>

	<div class="tyr-briefing-row">
	<section class="tyr-signal-card">
		<div class="tyr-signal-meta">
			<span>{heroKicker}</span>
			<span>//</span>
			<span>{heroDate}</span>
		</div>

		<h1
			class={`tyr-signal-title hud-headline mt-5 text-[var(--hud-text)] ${heroHeadlineLong ? 'tyr-signal-title--long' : ''}`}
		>
			{heroHeadline}
		</h1>

		<p class="tyr-signal-summary mt-5">{heroSummary}</p>

		{#if !data.latestSteamPost && HeroContent}
			<div class="mt-4 max-w-3xl">
				<HeroContent />
			</div>
		{/if}

		<div class="tyr-signal-actions mt-7">
			{#each data.hero.ctas.filter((cta) => cta.style === 'primary') as cta}
				<a
					href={cta.href}
					target={cta.external ? '_blank' : undefined}
					rel={cta.external ? 'noreferrer' : undefined}
					class="{cta.style === 'primary' ? 'hud-cta' : 'hud-cta-outline'} px-5 py-3"
				>
					{cta.style === 'primary' ? 'Join The Playtest' : cta.label}
				</a>
			{/each}

			{#if data.latestSteamPost}
				<a
					href={data.latestSteamPost.link}
					target="_blank"
					rel="noreferrer"
					class="hud-cta-outline px-5 py-3"
				>
					Read More
				</a>
			{/if}
		</div>
	</section>

		<a href="/game" class="tyr-briefing-panel">
			<img
				src="/brand/logos/tyr-logomark-white.png"
				alt=""
				class="tyr-briefing-panel__mark"
				aria-hidden="true"
			/>
			<div class="tyr-briefing-panel__kicker">New Recruit //</div>
			<div class="tyr-briefing-panel__headline">
				<span>What Is</span>
				<span class="tyr-briefing-panel__headline-row">
					Tyr
					<span class="tyr-briefing-panel__arrow" aria-hidden="true">&rarr;</span>
				</span>
			</div>
		</a>
	</div>

	{#if buildsWithVehicle.length > 0}
		<section class="flex flex-col gap-4">
			<div class="tyr-section-heading">
				<div class="tyr-shell-accent">
					<div class="tyr-shell-kicker">Community Loadouts</div>
					<h2 class="tyr-section-title">New Builds</h2>
				</div>
				<a href="/builds" class="hud-cta-ghost px-4 py-3">Browse All Builds</a>
			</div>

			<div class="grid gap-3 xl:grid-cols-2">
				{#each buildsWithVehicle as build}
					<a href="/builds/{build.slug}" class="tyr-build-card group">
						<FallbackImage
							src="/images/vehicles/{build.vehicleId}.png"
							alt=""
							kind="vehicle"
							label={build.vehicleName}
							class="pointer-events-none absolute right-0 top-1/2 h-40 w-40 -translate-y-1/2 object-contain opacity-90 transition-all duration-300 group-hover:scale-105 group-hover:opacity-100 md:h-48 md:w-48"
							style="-webkit-mask-image: linear-gradient(to left, black 40%, transparent 96%); mask-image: linear-gradient(to left, black 40%, transparent 96%);"
						/>

						<div class="relative z-10 grid min-h-[11rem] content-start gap-4 p-4 pr-24 md:p-5 md:pr-36">
							<div class="flex items-start justify-between gap-4">
								<div>
									<div class="hud-label">By {build.author}</div>
									<div class="mt-3 tyr-build-card__title text-[var(--hud-text)] transition-colors group-hover:text-[var(--hud-teal)]">
										{build.title}
									</div>
								</div>

								<div class="shrink-0 text-right">
									<div class="hud-eyebrow text-[var(--hud-muted)]">{build.vehicleName}</div>
								</div>
							</div>

							<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
								<span>{build.vehicleName}</span>
								<span class="text-[var(--hud-variant)]">//</span>
								<span class="hud-numeric">{build.updatedLabel}</span>
								{#if build.starCount > 0}
									<span class="text-[var(--hud-variant)]">//</span>
									<span class="inline-flex items-center gap-1 text-[var(--hud-lime)]">
										<span class="text-[0.78rem] leading-none">&#9733;</span>
										<span class="hud-label leading-none text-[var(--hud-lime)]">
											{build.starCount}
										</span>
									</span>
								{/if}
							</div>

							{#if build.components.length > 0 || build.ammo.length > 0 || build.isAlphaProgram}
								<div class="flex flex-wrap items-end gap-2">
									<div class="flex flex-wrap items-center gap-1">
										{#each build.components as component, index (`${component.id}-${index}`)}
											<div
												class="flex h-9 w-9 items-center justify-center bg-[rgba(15,21,33,0.92)] shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
												title={component.name}
											>
												<FallbackImage
													src="/images/components/{component.id}.png"
													alt={component.name}
													kind="component"
													label={component.name}
													forceFallback={component.forceFallback}
													class="h-6 w-6 object-contain"
												/>
											</div>
										{/each}

										{#each build.ammo as ammo, index (`${ammo.id}-${index}`)}
											<div
												class="flex h-9 w-9 items-center justify-center bg-[rgba(153,247,255,0.08)] shadow-[inset_0_0_0_1px_rgba(153,247,255,0.16)]"
												title={ammo.name}
											>
												<FallbackImage
													src="/images/ammo/{ammo.id}.png"
													alt={ammo.name}
													kind="ammo"
													label={ammo.name}
													class="h-6 w-6 object-contain"
												/>
											</div>
										{/each}
									</div>

									{#if build.isAlphaProgram}
										<div
											class="alpha-program-chip alpha-program-chip--compact shrink-0"
											title="Alpha Program vehicle"
											aria-label="Alpha Program vehicle"
										>
											<span class="alpha-program-chip__label">Alpha</span>
											<span class="alpha-program-chip__mark">
												<span class="alpha-program-chip__icon" aria-hidden="true"></span>
											</span>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<section class="hud-panel p-6">
		<div class="tyr-section-heading">
			<div class="tyr-shell-accent">
				<div class="tyr-shell-kicker">Official Signals</div>
				<h2 class="tyr-section-title">Dev Updates</h2>
			</div>
			<a
				href={siteCopy.newsUrl}
				target="_blank"
				rel="noreferrer"
				class="hud-cta-ghost px-4 py-3"
			>
				Steam News Hub
			</a>
		</div>

		{#if data.devVideos.length > 0}
			<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{#each data.devVideos as video}
					<a
						href="https://www.youtube.com/watch?v={video.videoId}"
						target="_blank"
						rel="noreferrer"
						class="tyr-video-card group"
						aria-label={video.title}
					>
						<div class="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[rgba(15,21,33,0.82)]">
							<img
								src={video.thumbnail}
								alt={video.title}
								class="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]"
							/>
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<p class="mt-4 text-sm leading-7 text-[var(--hud-muted)]">
				No dev videos yet. Check back soon.
			</p>
		{/if}
	</section>
</section>

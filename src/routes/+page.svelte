<script lang="ts">
	import type { Component } from 'svelte';
	import BuildCard from '$lib/components/BuildCard.svelte';
	import { siteCopy } from '$lib/content/site';
	import { toBuildCardData } from '$lib/utils/build-card';

	type MdModule = { default: Component<Record<string, never>> };
	const heroModules = import.meta.glob<MdModule>('/src/content/home/hero.md', { eager: true });
	const HeroContent = Object.values(heroModules)[0]?.default;

	let { data } = $props();

	const steamTitle = $derived(
		data.latestSteamPost?.title.replace(/^\[.*?\]\s*/, '').trim() ?? ''
	);

	const heroHeadline = $derived(steamTitle || data.hero.headline);
	const heroSummary = $derived(data.latestSteamPost?.summary ?? data.hero.tagline);
	const heroKicker = $derived(data.latestSteamPost ? 'Latest From Steam' : 'Pilot Briefing');
	const heroDate = $derived(data.latestSteamPost?.date ?? 'Live Companion Site');
	const heroHeadlineLong = $derived(heroHeadline.length > 42);

	const buildsWithVehicle = $derived(toBuildCardData(data.latestBuilds));
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

	{#if data.latestDispatches.length > 0}
		<section class="flex flex-col gap-4">
			<div class="tyr-section-heading">
				<div class="tyr-shell-accent">
					<div class="tyr-shell-kicker">Latest Dispatches</div>
					<h2 class="tyr-section-title">Field Manual</h2>
				</div>
				<div class="flex flex-wrap gap-2">
					<a href="/articles" class="hud-cta-ghost px-4 py-3">Articles</a>
					<a href="/guides" class="hud-cta-ghost px-4 py-3">Guides</a>
				</div>
			</div>

			<div class="grid gap-3">
				{#each data.latestDispatches as dispatch (dispatch.id)}
					<a
						href={`${dispatch.type === 'guide' ? '/guides' : '/articles'}/${dispatch.slug}`}
						class="flex gap-5 rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
						style="box-shadow: var(--hud-surface-ghost);"
					>
						{#if dispatch.heroImageUrl}
							<img
								src={dispatch.heroImageUrl}
								alt=""
								loading="lazy"
								decoding="async"
								class="h-24 w-32 flex-shrink-0 rounded-sm bg-[var(--hud-inset)] object-cover"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-3">
								{#if dispatch.isNew}
									<span class="tyr-new-pill">New</span>
								{/if}
								<span
									class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{dispatch.publishedAt.slice(0, 10)}
								</span>
								<span
									class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
								>
									{dispatch.type === 'guide' ? 'Guide' : 'Article'}
								</span>
								{#if dispatch.tags?.length}
									{#each dispatch.tags.slice(0, 2) as tag}
										<span
											class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
										>
											{tag}
										</span>
									{/each}
								{/if}
							</div>
							<h3
								class="mt-2 font-[var(--font-display)] text-lg font-semibold text-[var(--hud-text)]"
							>
								{dispatch.title}
							</h3>
							{#if dispatch.summary}
								<p class="mt-1 line-clamp-2 text-sm leading-6 text-[var(--hud-muted)]">
									{dispatch.summary}
								</p>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if buildsWithVehicle.length > 0}
		<section class="flex flex-col gap-4">
			<div class="tyr-section-heading">
				<div class="tyr-shell-accent">
					<div class="tyr-shell-kicker">Community Loadouts</div>
					<h2 class="tyr-section-title">New Builds</h2>
				</div>
				<a href="/builds/browse" class="hud-cta-ghost px-4 py-3">Browse All Builds</a>
			</div>

			<div class="grid gap-3 xl:grid-cols-2">
				{#each buildsWithVehicle as build (build.slug)}
					<BuildCard {build} />
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

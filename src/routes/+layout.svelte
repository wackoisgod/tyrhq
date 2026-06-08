<script lang="ts">
	import '../app.css';
	import { buildNavigation, footerSections, siteCopy } from '$lib/content/site';
	import { getAbsoluteUrl } from '$lib/site-url';
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { createBrowserClient } from '@supabase/ssr';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { env } from '$env/dynamic/public';
	import NavFlyout from '$lib/components/nav/NavFlyout.svelte';

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	let { children, data } = $props();

	const navigation = $derived(buildNavigation(data.flyoutEntries ?? []));

	const isActive = (href: string) =>
		href === '/'
			? page.url.pathname === href
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);

	const canonicalUrl = $derived(getAbsoluteUrl(page.url.pathname, page.url.origin));

	onMount(() => {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return;

		const supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			global: { fetch }
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event) => {
			if (event !== 'INITIAL_SESSION') {
				invalidate('supabase:auth');
			}
		});

		return () => subscription.unsubscribe();
	});
</script>

<svelte:head>
	<title>{siteCopy.title}</title>
	<meta name="description" content={siteCopy.description} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:url" content={canonicalUrl} />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="alternate icon" href="/brand/logos/tyr-logomark-white.png" type="image/png" />
</svelte:head>

<div class="min-h-screen bg-transparent">
	<header class="hud-header">
		<div class="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-5">
			<div class="tyr-topbar">
				<div>{siteCopy.title}</div>
				<div class="tyr-topbar__center">{siteCopy.tagline}</div>
				<div class="tyr-topbar__right">
					{#if data.pendingReviewCount > 0}
						<a
							href="/admin/submissions"
							class="tyr-review-pill"
							aria-label="{data.pendingReviewCount} submission{data.pendingReviewCount === 1 ? '' : 's'} awaiting review"
						>
							<span class="tyr-review-pill__label">Review</span>
							<span class="tyr-review-pill__count">{data.pendingReviewCount}</span>
						</a>
					{/if}
					<a
						href={data.user ? '/settings' : '/auth'}
						class="tyr-account-chip"
						aria-label={data.user ? 'Pilot account settings' : 'Sign in'}
					>
						<span class="tyr-account-chip__mark" aria-hidden="true">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">
								<circle cx="12" cy="8.5" r="3.5" />
								<path d="M5 20.5c0-3.9 3.1-7 7-7s7 3.1 7 7" />
							</svg>
						</span>
						<span class="tyr-account-chip__label">
							{#if data.user}
								Pilot <span class="tyr-account-chip__sep">//</span> {data.profile?.display_name ?? data.user.email?.split('@')[0] ?? 'Pilot'}
							{:else}
								Pilot <span class="tyr-account-chip__sep">//</span> Sign In
							{/if}
						</span>
					</a>
				</div>
			</div>

			<div class="tyr-brandbar">
				<div class="tyr-brand-column">
					<a href="/" class="tyr-mark-link" aria-label="Tyr HQ home">
						<img
							src="/brand/logos/tyr-logomark-white.png"
							alt=""
							class="tyr-logo-mark"
							aria-hidden="true"
						/>
						<img
							src="/brand/logos/tyr-wordmark-white-horizontal.png"
							alt=""
							class="tyr-logo-wordmark"
							aria-hidden="true"
						/>
					</a>

					<nav class="tyr-nav" aria-label="Primary">
						{#each navigation as item}
							{#if 'columns' in item}
								<NavFlyout {item} {isActive} />
							{:else}
								<a
									href={item.href}
									class="tyr-nav-link"
									aria-current={isActive(item.href) ? 'page' : undefined}
								>
									{item.label}
								</a>
							{/if}
						{/each}
					</nav>
				</div>

				<div class="tyr-actions">
					<div class="tyr-header-actions">
						<a
							href={siteCopy.wishlistUrl}
							target="_blank"
							rel="noreferrer"
							class="hud-cta-outline tyr-header-button px-6 py-3"
						>
							Wishlist On Steam
						</a>
						<a
							href={siteCopy.playtestUrl}
							target="_blank"
							rel="noreferrer"
							class="hud-cta tyr-primary-cta tyr-header-button px-6 py-3"
						>
							Join The Playtest
						</a>
					</div>
				</div>
			</div>

		</div>
	</header>

	<main>{@render children()}</main>

	<footer class="hud-footer">
		<div class="mx-auto grid max-w-7xl gap-10 px-4 py-10 md:grid-cols-[1.1fr_1.9fr] md:px-6">
			<div>
				<img
					src="/brand/logos/tyr-full-logo-white-horizontal.png"
					alt="Tyr"
					class="tyr-footer-logo"
				/>
				<p class="mt-5 max-w-md text-sm leading-7 text-[var(--hud-muted)]">{siteCopy.description}</p>
				<p class="mt-4 hud-eyebrow">{siteCopy.tagline}</p>
				<p class="mt-5 max-w-md text-sm leading-7 text-[var(--hud-muted)]">
					{siteCopy.statusDisclaimer}
				</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each footerSections as section}
					<div class="hud-panel-muted p-4">
						<h2 class="hud-label">{section.title}</h2>
						<div class="mt-4 flex flex-col gap-3 text-sm text-[var(--hud-muted)]">
							{#each section.links as link}
								<a href={link.href} class="hud-link">{link.label}</a>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="tyr-footer-legal" role="note" aria-label="Third-party site notice">
			<div class="mx-auto grid max-w-7xl items-center gap-4 px-4 py-5 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] md:px-6">
				<div class="tyr-footer-legal__label">Third-Party Notice</div>
				<p class="tyr-footer-legal__copy">{siteCopy.legalDisclaimer}</p>
				<p class="tyr-footer-legal__copy">{siteCopy.rightsDisclaimer}</p>
			</div>
		</div>
	</footer>
</div>

<script lang="ts">
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
	import TableOfContents from '$lib/contribute/TableOfContents.svelte';
	import { ensureHeadingIds, extractHeadings } from '$lib/contribute/toc';
	import type { Snippet } from 'svelte';

	type Vehicle = { slug: string; name: string };

	let {
		type,
		article,
		vehicles = [],
		backHref,
		backLabel,
		headerActions,
		footer,
		banner
	}: {
		type: 'guide' | 'article' | 'patch';
		article: {
			title: string;
			summary: string | null;
			tags: string[] | null;
			publishedAt: string;
			authorDisplay: string | null;
			bodyHtml: string;
			heroImageUrl?: string | null;
			isNew?: boolean;
			isPinned?: boolean;
			version?: string | null;
		};
		vehicles?: Vehicle[];
		backHref: string;
		backLabel: string;
		headerActions?: Snippet;
		footer?: Snippet;
		banner?: Snippet;
	} = $props();

	function formatDate(iso: string): string {
		return iso.slice(0, 10);
	}

	// Inject heading ids server-side so deep links resolve in the initial HTML —
	// even for legacy articles stored before ids were baked in — then derive the
	// TOC from the same id'd HTML so links and anchors always match.
	const bodyHtml = $derived(ensureHeadingIds(article.bodyHtml));
	const headings = $derived(extractHeadings(bodyHtml));
</script>

<svelte:head>
	<title>Tyr HQ | {article.title}</title>
	{#if article.summary}
		<meta name="description" content={article.summary} />
	{/if}
</svelte:head>

<div class="article-grid mx-auto w-full max-w-[100rem] px-4 py-8 md:px-6">
	<article class="article-grid__main mx-auto w-full min-w-0 max-w-3xl">
		{#if banner}{@render banner()}{/if}

	<a
		href={backHref}
		class="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		<span
			aria-hidden="true"
			class="flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel-mid)] text-[var(--hud-teal)] transition group-hover:border-[var(--hud-teal)]/60 group-hover:bg-[var(--hud-teal)]/10"
		>
			<svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M10 3 5 8l5 5" />
			</svg>
		</span>
		{backLabel}
	</a>

	<div class="mt-6">
		<div class="flex flex-wrap items-center gap-3">
			{#if type === 'guide' && article.isPinned}
				<span class="tyr-pinned-pill">
					<svg
						class="h-3 w-3"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="m15 4 5 5-4 1-4 4v4l-2 2-2-6-6-2 2-2h4l4-4z" />
					</svg>
					Pinned
				</span>
			{/if}
			{#if article.isNew}
				<span class="tyr-new-pill">New</span>
			{/if}
			{#if type === 'patch' && article.version}
				<span
					class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-teal)]"
				>
					{article.version}
				</span>
			{/if}
			<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				{formatDate(article.publishedAt)}
			</span>
			{#if article.tags?.length}
				{#each article.tags as tag}
					<span
						class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
					>
						{tag}
					</span>
				{/each}
			{/if}
		</div>

		<div class="mt-4 flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0 flex-1">
				<h1
					class="font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
				>
					{article.title}
				</h1>
				{#if article.authorDisplay}
					<p class="mt-2 text-sm text-[var(--hud-dim)]">By {article.authorDisplay}</p>
				{/if}
			</div>
			{#if headerActions}
				<div class="flex flex-wrap items-center gap-2">
					{@render headerActions()}
				</div>
			{/if}
		</div>

		{#if type === 'guide' && vehicles.length > 0}
			<div class="mt-5 flex flex-wrap items-center gap-2">
				<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
					Vehicles Covered
				</span>
				{#each vehicles as vehicle}
					<a
						href="/tools/tanks/{vehicle.slug}"
						class="rounded-sm bg-[var(--hud-inset)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.3)] transition hover:text-[var(--hud-teal)]"
					>
						{vehicle.name}
					</a>
				{/each}
			</div>
		{/if}
	</div>

	{#if article.heroImageUrl}
		<img
			src={article.heroImageUrl}
			alt=""
			loading="eager"
			decoding="async"
			class="mt-8 w-full rounded-sm bg-[var(--hud-inset)] object-cover"
		/>
	{/if}

		{#if headings.length > 1}
			<!-- Narrow screens: collapsible TOC panel above the body. The sticky
			     side rail (below) takes over once there's room for a gutter. -->
			<div class="xl:hidden">
				<TableOfContents {headings} />
			</div>
		{/if}

		<div class="mt-8">
			<ArticleBody html={bodyHtml} />
		</div>

		{#if footer}{@render footer()}{/if}
	</article>

	{#if headings.length > 1}
		<aside class="article-grid__aside hidden xl:block">
			<div class="article-toc-rail">
				<TableOfContents {headings} sidebar />
			</div>
		</aside>
	{/if}
</div>

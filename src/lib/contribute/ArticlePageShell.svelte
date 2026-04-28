<script lang="ts">
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
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
		type: 'guide' | 'article';
		article: {
			title: string;
			summary: string | null;
			tags: string[] | null;
			publishedAt: string;
			authorDisplay: string | null;
			bodyHtml: string;
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
</script>

<svelte:head>
	<title>Tyr HQ | {article.title}</title>
	{#if article.summary}
		<meta name="description" content={article.summary} />
	{/if}
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-8 md:px-6">
	{#if banner}{@render banner()}{/if}

	<a
		href={backHref}
		class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		{backLabel}
	</a>

	<div class="mt-6">
		<div class="flex flex-wrap items-center gap-3">
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

	<div class="mt-8">
		<ArticleBody html={article.bodyHtml} />
	</div>

	{#if footer}{@render footer()}{/if}
</article>

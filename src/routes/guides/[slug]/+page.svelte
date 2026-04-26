<script lang="ts">
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
	import ArticleActionsBar from '$lib/contribute/ArticleActionsBar.svelte';

	let { data } = $props();

	function formatDate(iso: string): string {
		return iso.slice(0, 10);
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.guide.title}</title>
	{#if data.guide.summary}
		<meta name="description" content={data.guide.summary} />
	{/if}
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-8 md:px-6">
	<a
		href="/guides"
		class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		Back To Guides
	</a>

	<div class="mt-6">
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				{formatDate(data.guide.publishedAt)}
			</span>
			{#if data.guide.tags?.length}
				{#each data.guide.tags as tag}
					<span
						class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
					>
						{tag}
					</span>
				{/each}
			{/if}
		</div>

		<h1
			class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
		>
			{data.guide.title}
		</h1>

		{#if data.guide.authorDisplay}
			<p class="mt-2 text-sm text-[var(--hud-dim)]">By {data.guide.authorDisplay}</p>
		{/if}

		{#if data.vehicles.length > 0}
			<div class="mt-5 flex flex-wrap items-center gap-2">
				<span
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Vehicles Covered
				</span>
				{#each data.vehicles as vehicle}
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
		<ArticleBody html={data.guide.bodyHtml} />
	</div>

	<ArticleActionsBar
		articleId={data.guide.id}
		articleType="guide"
		signedIn={Boolean(data.user)}
		canModerate={data.role === 'contributor' || data.role === 'admin'}
	/>
</article>

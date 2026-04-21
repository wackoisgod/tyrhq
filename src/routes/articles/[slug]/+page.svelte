<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Tyr HQ | {data.post.title}</title>
	{#if data.post.summary}
		<meta name="description" content={data.post.summary} />
	{/if}
</svelte:head>

<article class="mx-auto max-w-3xl px-4 py-8 md:px-6">
	<a
		href="/articles"
		class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		Back To Articles
	</a>

	<div class="mt-6">
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				{data.post.date}
			</span>
			{#if data.post.tags?.length}
				{#each data.post.tags as tag}
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
			{data.post.title}
		</h1>

		{#if data.post.author}
			<p class="mt-2 text-sm text-[var(--hud-dim)]">By {data.post.author}</p>
		{/if}
	</div>

	<div class="prose-hud mt-8">
		{@html data.post.html}
	</div>
</article>

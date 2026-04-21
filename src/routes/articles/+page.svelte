<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Tyr HQ | Articles</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Dispatches
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Articles
	</h1>

	{#if data.posts.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No articles yet. Check back soon.</p>
		</div>
	{:else}
		<div class="mt-8 flex flex-col gap-4">
			{#each data.posts as post}
				<a
					href="/articles/{post.slug}"
					class="rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{post.date}
						</span>
						{#if post.tags?.length}
							{#each post.tags as tag}
								<span
									class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
								>
									{tag}
								</span>
							{/each}
						{/if}
					</div>
					<h2
						class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]"
					>
						{post.title}
					</h2>
					{#if post.summary}
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{post.summary}</p>
					{/if}
					{#if post.author}
						<p class="mt-3 text-xs text-[var(--hud-dim)]">By {post.author}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</section>

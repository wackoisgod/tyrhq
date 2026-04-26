<script lang="ts">
	import type { Component } from 'svelte';

	let { data } = $props();

	type MdModule = { default: Component<Record<string, never>> };
	const guides = import.meta.glob<MdModule>('/src/content/guides/*.md', { eager: true });

	const Content = $derived.by(() => {
		const entry = Object.entries(guides).find(([path]) => {
			const basename = path.split('/').pop()!.replace(/\.md$/, '');
			const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
			return slug === data.guide.slug;
		});
		return entry?.[1]?.default;
	});
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
				{data.guide.date}
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

		{#if data.guide.author}
			<p class="mt-2 text-sm text-[var(--hud-dim)]">By {data.guide.author}</p>
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
		{#if Content}
			<Content />
		{/if}
	</div>
</article>

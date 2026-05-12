<script lang="ts">
	import RevisionHistoryTimeline from '$lib/contribute/RevisionHistoryTimeline.svelte';
	import type {
		ArticleContributor,
		ArticleRevisionSummary
	} from '$lib/server/article-revisions';

	let {
		title,
		basePath,
		articleHref,
		currentRevisionId,
		revisions,
		contributors
	}: {
		title: string;
		basePath: string;
		articleHref: string;
		currentRevisionId: string | null;
		revisions: ArticleRevisionSummary[];
		contributors: ArticleContributor[];
	} = $props();
</script>

<svelte:head>
	<title>Tyr HQ | Revision history · {title}</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-4 py-8 md:px-6">
	<a
		href={articleHref}
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
		Back to article
	</a>

	<header class="mt-6">
		<p class="hud-eyebrow tracking-[0.3em]">Revision history</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
		>
			{title}
		</h1>
		<p class="mt-3 text-sm text-[var(--hud-muted)]">
			Every approved revision is recorded here, with credit to the contributor who wrote it.
		</p>
	</header>

	{#if contributors.length > 0}
		<div class="mt-6 hud-panel-muted p-4">
			<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				Contributors
			</p>
			<ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--hud-text)]">
				{#each contributors as contributor (contributor.userId)}
					<li>
						{contributor.displayName ?? 'Anonymous'}
						<span class="text-[var(--hud-dim)]">
							({contributor.contributionCount}
							{contributor.contributionCount === 1 ? 'edit' : 'edits'})
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="mt-8">
		{#if revisions.length === 0}
			<p class="text-sm text-[var(--hud-muted)]">
				No revisions recorded yet. (Articles published before contributor tracking shipped may
				not appear in history.)
			</p>
		{:else}
			<RevisionHistoryTimeline
				{revisions}
				{currentRevisionId}
				diffHrefFor={(id) => `${basePath}/${id}`}
			/>
		{/if}
	</div>
</section>

<script lang="ts">
	import ArticlePageShell from '$lib/contribute/ArticlePageShell.svelte';

	let { data } = $props();

	const article = $derived({
		title: data.submission.title,
		summary: data.submission.summary,
		tags: data.submission.tags,
		publishedAt: data.submission.updatedAt,
		authorDisplay: data.submission.authorDisplay,
		bodyHtml: data.submission.bodyHtml,
		heroImageUrl: data.submission.heroImageUrl
	});
</script>

<ArticlePageShell
	type={data.submission.type}
	{article}
	vehicles={data.vehicles}
	backHref="/contribute/{data.submission.id}/edit"
	backLabel="← Back To Draft"
>
	{#snippet banner()}
		<div
			class="mb-6 rounded-sm border-l-2 border-[var(--hud-teal)] bg-[var(--hud-teal)]/10 p-3"
		>
			<div
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				Preview · not yet published
			</div>
			<p class="mt-1 text-xs text-[var(--hud-muted)]">
				This is how your {data.submission.type} will appear on the site after a reviewer
				approves it. Date shown is the draft's last-saved time.
			</p>
			{#if data.renderError}
				<p class="mt-2 text-xs text-[var(--hud-lime)]">
					Body failed to render: {data.renderError}. Fix this before submitting.
				</p>
			{/if}
		</div>
	{/snippet}
</ArticlePageShell>

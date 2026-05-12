<script lang="ts">
	import RevisionDiffView from '$lib/contribute/RevisionDiffView.svelte';
	import type { RevisionDiff } from '$lib/server/article-revisions';

	let {
		title,
		historyHref,
		diff
	}: {
		title: string;
		historyHref: string;
		diff: RevisionDiff;
	} = $props();
</script>

<svelte:head>
	<title>Tyr HQ | Revision diff · {title}</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<a
		href={historyHref}
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
		Back to history
	</a>

	<header class="mt-6">
		<p class="hud-eyebrow tracking-[0.3em]">Revision diff</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
		>
			{title}
		</h1>
	</header>

	<div class="mt-8">
		<RevisionDiffView {diff} />
	</div>
</section>

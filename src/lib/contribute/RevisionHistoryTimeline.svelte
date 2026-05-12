<script lang="ts">
	import type { ArticleRevisionSummary } from '$lib/server/article-revisions';

	let {
		revisions,
		diffHrefFor,
		currentRevisionId = null
	}: {
		revisions: ArticleRevisionSummary[];
		diffHrefFor: (revisionId: string) => string;
		currentRevisionId?: string | null;
	} = $props();

	function formatDate(iso: string): string {
		const d = new Date(iso);
		const date = d.toISOString().slice(0, 10);
		const time = d.toISOString().slice(11, 16);
		return `${date} ${time} UTC`;
	}
</script>

<ol class="hud-timeline">
	{#each revisions as revision, idx (revision.id)}
		{@const isFirst = idx === revisions.length - 1}
		{@const isCurrent = revision.id === currentRevisionId}
		<li class="hud-timeline-item">
			<div class="hud-timeline-dot" aria-hidden="true"></div>
			<div class="hud-timeline-body">
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<span class="font-mono text-xs text-[var(--hud-muted)]">
						{formatDate(revision.createdAt)}
					</span>
					{#if isCurrent}
						<span
							class="rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-on-teal)]"
						>
							Current
						</span>
					{/if}
					{#if isFirst}
						<span
							class="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							Initial publish
						</span>
					{/if}
				</div>
				<p class="mt-1 text-sm text-[var(--hud-text)]">
					{#if revision.submitterDisplay}
						<span class="font-semibold">{revision.submitterDisplay}</span>
					{:else}
						<span class="text-[var(--hud-dim)]">Anonymous contributor</span>
					{/if}
					<span class="text-[var(--hud-muted)]">— {revision.title}</span>
				</p>
				{#if !isFirst}
					<p class="mt-1.5 text-[10px] uppercase tracking-[0.18em]">
						<a class="hud-link" href={diffHrefFor(revision.id)}>View diff vs previous</a>
					</p>
				{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	.hud-timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		position: relative;
	}
	.hud-timeline::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 6px;
		bottom: 6px;
		width: 1px;
		background: var(--hud-variant, rgba(255, 255, 255, 0.1));
	}
	.hud-timeline-item {
		position: relative;
		padding-left: 22px;
		padding-bottom: 1.25rem;
	}
	.hud-timeline-item:last-child {
		padding-bottom: 0;
	}
	.hud-timeline-dot {
		position: absolute;
		left: 0;
		top: 7px;
		height: 11px;
		width: 11px;
		border-radius: 50%;
		background: var(--hud-panel-mid);
		box-shadow: 0 0 0 2px var(--hud-teal);
	}
</style>

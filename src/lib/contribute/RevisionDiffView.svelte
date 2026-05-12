<script lang="ts">
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
	import type { RevisionDiff } from '$lib/server/article-revisions';

	let { diff: revisionDiff }: { diff: RevisionDiff } = $props();

	let diffView = $state<'inline' | 'side-by-side'>('inline');

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
	}
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-baseline justify-between gap-3">
		<div>
			<p
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Revision by
			</p>
			<p class="mt-1 text-sm text-[var(--hud-text)]">
				{revisionDiff.revision.submitterDisplay ?? 'Anonymous contributor'}
				<span class="text-[var(--hud-muted)]">
					· {formatDate(revisionDiff.revision.createdAt)}
				</span>
			</p>
		</div>
		{#if revisionDiff.previous}
			<div class="text-right">
				<p
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Compared against
				</p>
				<p class="mt-1 text-xs text-[var(--hud-muted)]">
					{revisionDiff.previous.submitterDisplay ?? 'Anonymous'}
					· {formatDate(revisionDiff.previous.createdAt)}
				</p>
			</div>
		{:else}
			<p class="text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				Initial publish — nothing to diff against
			</p>
		{/if}
	</div>

	{#if revisionDiff.previous}
		{#if revisionDiff.diff.fieldDeltas.length > 0}
			<div
				class="rounded-sm bg-[var(--hud-panel)] p-4"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				<div
					class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Field changes
				</div>
				<dl class="grid gap-3 text-sm">
					{#each revisionDiff.diff.fieldDeltas as delta (delta.field)}
						<div class="grid gap-1 md:grid-cols-[140px_1fr] md:items-baseline">
							<dt
								class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)]"
							>
								{delta.label}
							</dt>
							<dd>
								{#if delta.kind === 'list'}
									<div class="flex flex-wrap gap-1.5">
										{#each delta.removed as tag}
											<span class="diff-chip diff-chip-del">−{tag}</span>
										{/each}
										{#each delta.added as tag}
											<span class="diff-chip diff-chip-add">+{tag}</span>
										{/each}
									</div>
								{:else}
									<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
										{#if delta.before}
											<span class="diff-token diff-token-del">{delta.before}</span>
										{/if}
										{#if delta.after}
											<span class="diff-token diff-token-add">{delta.after}</span>
										{/if}
									</div>
								{/if}
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		{/if}

		<div>
			<div class="mb-2 flex flex-wrap items-center justify-between gap-3">
				<div
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Body changes
					{#if !revisionDiff.diff.bodyChanged}
						<span class="ml-2 normal-case tracking-normal text-[var(--hud-muted)]">
							(no body changes)
						</span>
					{/if}
				</div>
				{#if revisionDiff.diff.bodyChanged}
					<div class="flex gap-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
						<button
							type="button"
							class="diff-toggle"
							class:is-active={diffView === 'inline'}
							onclick={() => (diffView = 'inline')}
						>
							Inline diff
						</button>
						<button
							type="button"
							class="diff-toggle"
							class:is-active={diffView === 'side-by-side'}
							onclick={() => (diffView = 'side-by-side')}
						>
							Side-by-side
						</button>
					</div>
				{/if}
			</div>

			{#if !revisionDiff.diff.bodyChanged}
				<div
					class="rounded-sm bg-[var(--hud-panel)] p-4"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<ArticleBody html={revisionDiff.revision.bodyHtml} />
				</div>
			{:else if diffView === 'inline'}
				<div
					class="rounded-sm bg-[var(--hud-panel)] p-4"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<pre class="diff-body"><!--
						-->{#each revisionDiff.diff.bodyChunks as chunk, i (i)}{#if chunk.kind === 'add'}<span
									class="diff-add">{chunk.value}</span
								>{:else if chunk.kind === 'del'}<span class="diff-del">{chunk.value}</span
								>{:else}{chunk.value}{/if}{/each}</pre>
				</div>
			{:else}
				<div class="grid gap-6 md:grid-cols-2">
					<div>
						<div
							class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							Previous revision
						</div>
						<div
							class="rounded-sm bg-[var(--hud-panel)] p-4"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<ArticleBody html={revisionDiff.previous.bodyHtml} />
						</div>
					</div>
					<div>
						<div
							class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							This revision
						</div>
						<div
							class="rounded-sm bg-[var(--hud-panel)] p-4"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<ArticleBody html={revisionDiff.revision.bodyHtml} />
						</div>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div
			class="rounded-sm bg-[var(--hud-panel)] p-4"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<ArticleBody html={revisionDiff.revision.bodyHtml} />
		</div>
	{/if}
</div>

<style>
	.diff-body {
		margin: 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.8125rem;
		line-height: 1.65;
		color: var(--hud-muted);
		white-space: pre-wrap;
		word-wrap: break-word;
		max-height: 70vh;
		overflow-y: auto;
	}
	.diff-add {
		background: rgba(98, 232, 132, 0.18);
		color: #b8ffce;
		box-shadow: inset 0 -1px 0 0 rgba(98, 232, 132, 0.6);
		border-radius: 1px;
		padding: 0 1px;
	}
	.diff-del {
		background: rgba(255, 92, 122, 0.16);
		color: #ffb0bf;
		text-decoration: line-through;
		text-decoration-color: rgba(255, 92, 122, 0.7);
		border-radius: 1px;
		padding: 0 1px;
	}
	.diff-toggle {
		padding: 0.35rem 0.75rem;
		color: var(--hud-dim);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 2px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.diff-toggle:hover {
		color: var(--hud-text);
	}
	.diff-toggle.is-active {
		color: var(--hud-teal);
		border-color: var(--hud-teal);
		background: rgba(153, 247, 255, 0.08);
	}
	.diff-token {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.8125rem;
		padding: 0.1rem 0.35rem;
		border-radius: 2px;
		word-break: break-word;
	}
	.diff-token-del {
		background: rgba(255, 92, 122, 0.16);
		color: #ffb0bf;
		text-decoration: line-through;
		text-decoration-color: rgba(255, 92, 122, 0.7);
	}
	.diff-token-add {
		background: rgba(98, 232, 132, 0.18);
		color: #b8ffce;
		box-shadow: inset 0 -1px 0 0 rgba(98, 232, 132, 0.6);
	}
	.diff-chip {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		border-radius: 2px;
		letter-spacing: 0.02em;
	}
	.diff-chip-del {
		background: rgba(255, 92, 122, 0.16);
		color: #ffb0bf;
		text-decoration: line-through;
		text-decoration-color: rgba(255, 92, 122, 0.7);
	}
	.diff-chip-add {
		background: rgba(98, 232, 132, 0.18);
		color: #b8ffce;
	}
</style>

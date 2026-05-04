<script lang="ts">
	import { goto } from '$app/navigation';
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
	import { FLYOUT_SECTIONS, type FlyoutSection } from '$lib/content/flyout-sections';

	let { data } = $props();

	let notes = $state('');
	let busy = $state(false);
	let error = $state('');
	let diffView = $state<'inline' | 'side-by-side'>('inline');
	// Default the override fields to whatever the contributor proposed (or
	// whatever the admin previously set). Admin can change before approving.
	/* svelte-ignore state_referenced_locally */
	let flyoutSection = $state<FlyoutSection | ''>(data.submission.flyout_section ?? '');
	/* svelte-ignore state_referenced_locally */
	let flyoutOrder = $state<string>(
		data.submission.flyout_order != null ? String(data.submission.flyout_order) : ''
	);

	async function decide(decision: 'approve' | 'changes_requested' | 'reject') {
		if (busy) return;
		if (decision === 'reject' && !window.confirm('Reject this submission permanently?')) return;
		if (decision === 'changes_requested' && !notes.trim()) {
			error = 'Please leave a note explaining what to change.';
			return;
		}
		busy = true;
		error = '';
		try {
			const orderNum = flyoutOrder.trim() === '' ? null : Number(flyoutOrder);
			if (orderNum != null && Number.isNaN(orderNum)) {
				error = 'Flyout order must be a number.';
				busy = false;
				return;
			}
			const payload: Record<string, unknown> = {
				decision,
				notes: notes || null,
				// Optimistic-concurrency guard: the contributor can edit a pending
				// submission while we read it. Send the hash we reviewed so the
				// server rejects the decision if the body changed underneath us.
				expectedContentHash: data.submission.content_hash ?? null
			};
			if (decision === 'approve') {
				payload.flyoutSection = flyoutSection || null;
				payload.flyoutOrder = flyoutSection ? orderNum : null;
			}
			const res = await fetch(`/api/admin/submissions/${data.submission.id}/decision`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			await goto('/admin/submissions');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Decision failed';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Tyr HQ | Review submission</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<a
		href="/admin/submissions"
		class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		← Queue
	</a>

	<div class="mt-4 flex flex-wrap items-center gap-3">
		<span
			class="rounded-sm bg-[var(--hud-teal)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--hud-teal)]"
		>
			{data.submission.status.replace('_', ' ')}
		</span>
		<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
			{data.submission.type}
		</span>
		{#if data.parentArticle}
			<span
				class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
			>
				Suggested edit to /{data.parentArticle.type === 'guide' ? 'guides' : data.parentArticle.type === 'patch' ? 'patch-notes' : 'articles'}/{data.parentArticle.slug}
			</span>
		{/if}
	</div>

	<h1
		class="mt-2 font-[var(--font-display)] text-3xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
	>
		{data.submission.title || '(Untitled)'}
	</h1>
	{#if data.submission.summary}
		<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{data.submission.summary}</p>
	{/if}

	{#if data.submission.hero_image_url}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				Hero image
			</span>
			<img
				src={data.submission.hero_image_url}
				alt=""
				class="max-h-24 rounded-sm bg-[var(--hud-inset)] object-cover"
			/>
		</div>
	{/if}

	{#if data.renderError}
		<div
			class="mt-4 rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]"
		>
			This submission failed to render: {data.renderError}. Approving it will fail until the
			contributor fixes the body. Use "Request changes" with a note pointing at the issue.
		</div>
	{/if}

	{#if data.parentArticle && data.diff}
		{#if data.diff.fieldDeltas.length > 0}
			<div
				class="mt-8 rounded-sm bg-[var(--hud-panel)] p-4"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				<div
					class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Field changes
				</div>
				<dl class="grid gap-3 text-sm">
					{#each data.diff.fieldDeltas as delta (delta.field)}
						<div class="grid gap-1 md:grid-cols-[140px_1fr] md:items-baseline">
							<dt
								class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)]"
							>
								{delta.label}
							</dt>
							<dd class="diff-field">
								{#if delta.kind === 'list'}
									<div class="flex flex-wrap gap-1.5">
										{#each delta.removed as tag}
											<span class="diff-chip diff-chip-del">−{tag}</span>
										{/each}
										{#each delta.added as tag}
											<span class="diff-chip diff-chip-add">+{tag}</span>
										{/each}
									</div>
								{:else if delta.field === 'heroImageUrl'}
									<div class="flex flex-wrap items-center gap-3">
										{#if delta.before}
											<figure class="diff-hero diff-hero-del">
												<img src={delta.before} alt="" />
												<figcaption>before</figcaption>
											</figure>
										{/if}
										{#if delta.after}
											<figure class="diff-hero diff-hero-add">
												<img src={delta.after} alt="" />
												<figcaption>after</figcaption>
											</figure>
										{/if}
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

		<div class="mt-8">
			<div class="mb-2 flex flex-wrap items-center justify-between gap-3">
				<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
					Body changes
					{#if !data.diff.bodyChanged}
						<span class="ml-2 normal-case tracking-normal text-[var(--hud-muted)]">
							(no body changes)
						</span>
					{/if}
				</div>
				{#if data.diff.bodyChanged}
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

			{#if !data.diff.bodyChanged}
				<div
					class="rounded-sm bg-[var(--hud-panel)] p-4"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<ArticleBody html={data.renderedHtml} />
				</div>
			{:else if diffView === 'inline'}
				<div
					class="rounded-sm bg-[var(--hud-panel)] p-4"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<pre class="diff-body"><!--
					-->{#each data.diff.bodyChunks as chunk, i (i)}{#if chunk.kind === 'add'}<span
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
							Currently published
						</div>
						<div
							class="rounded-sm bg-[var(--hud-panel)] p-4"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<ArticleBody html={data.parentArticle.bodyHtml} />
						</div>
					</div>
					<div>
						<div
							class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Proposed
						</div>
						<div
							class="rounded-sm bg-[var(--hud-panel)] p-4"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<ArticleBody html={data.renderedHtml} />
						</div>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="mt-8 rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
			<ArticleBody html={data.renderedHtml} />
		</div>
	{/if}

	<div class="mt-8 rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
		<label
			for="notes"
			class="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			Reviewer notes (required for "Request changes"; optional otherwise)
		</label>
		<textarea
			id="notes"
			bind:value={notes}
			rows="3"
			class="hud-input mt-2 w-full rounded-sm p-2 text-sm"
			placeholder="Visible to the contributor."
		></textarea>

		{#if error}
			<p class="mt-3 text-sm text-[var(--hud-lime)]">{error}</p>
		{/if}

		<div class="mt-6 grid gap-3 border-t border-[var(--hud-inset)] pt-4 md:grid-cols-[1fr_120px]">
			<div>
				<label
					for="flyoutSection"
					class="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Resources flyout section
				</label>
				<select
					id="flyoutSection"
					bind:value={flyoutSection}
					class="hud-input mt-2 w-full rounded-sm p-2 text-sm"
				>
					<option value="">— None —</option>
					{#each FLYOUT_SECTIONS as section}
						<option value={section}>{section}</option>
					{/each}
				</select>
				{#if data.submission.flyout_section}
					<p class="mt-1 text-[11px] text-[var(--hud-dim)]">
						Contributor proposed: {data.submission.flyout_section}
					</p>
				{/if}
			</div>
			<div>
				<label
					for="flyoutOrder"
					class="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Order
				</label>
				<input
					id="flyoutOrder"
					bind:value={flyoutOrder}
					type="number"
					step="1"
					placeholder="0"
					disabled={!flyoutSection}
					class="hud-input mt-2 w-full rounded-sm p-2 text-sm disabled:opacity-40"
				/>
				<p class="mt-1 text-[11px] text-[var(--hud-dim)]">Lower = earlier.</p>
			</div>
		</div>

		{#if !data.canApprove}
			<p class="mt-3 text-xs text-[var(--hud-dim)]">
				You're the author of this submission. Another reviewer needs to approve it.
			</p>
		{/if}

		<div class="mt-4 flex flex-wrap gap-3">
			<button
				type="button"
				onclick={() => decide('approve')}
				disabled={busy || !data.canApprove}
				class="hud-cta px-5 py-3 text-sm disabled:opacity-50"
			>
				{busy ? 'Working…' : 'Approve & Publish'}
			</button>
			<button
				type="button"
				onclick={() => decide('changes_requested')}
				disabled={busy}
				class="hud-cta-outline px-5 py-3 text-sm disabled:opacity-50"
			>
				Request Changes
			</button>
			<button
				type="button"
				onclick={() => decide('reject')}
				disabled={busy}
				class="hud-cta-ghost px-5 py-3 text-sm disabled:opacity-50"
			>
				Reject
			</button>
		</div>
	</div>
</section>

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

	.diff-hero {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 4px;
		border-radius: 2px;
	}
	.diff-hero img {
		max-height: 80px;
		max-width: 140px;
		border-radius: 2px;
		object-fit: cover;
		display: block;
	}
	.diff-hero figcaption {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		text-align: center;
	}
	.diff-hero-del {
		background: rgba(255, 92, 122, 0.12);
	}
	.diff-hero-del figcaption {
		color: #ffb0bf;
	}
	.diff-hero-del img {
		filter: grayscale(0.5);
		opacity: 0.7;
	}
	.diff-hero-add {
		background: rgba(98, 232, 132, 0.12);
	}
	.diff-hero-add figcaption {
		color: #b8ffce;
	}
</style>

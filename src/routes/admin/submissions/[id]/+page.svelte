<script lang="ts">
	import { goto } from '$app/navigation';
	import ArticleBody from '$lib/contribute/ArticleBody.svelte';
	import { FLYOUT_SECTIONS, type FlyoutSection } from '$lib/content/flyout-sections';

	let { data } = $props();

	let notes = $state('');
	let busy = $state(false);
	let error = $state('');
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
				notes: notes || null
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
				Suggested edit to /{data.parentArticle.type === 'guide' ? 'guides' : 'articles'}/{data.parentArticle.slug}
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

	{#if data.renderError}
		<div
			class="mt-4 rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]"
		>
			This submission failed to render: {data.renderError}. Approving it will fail until the
			contributor fixes the body. Use "Request changes" with a note pointing at the issue.
		</div>
	{/if}

	{#if data.parentArticle}
		<div class="mt-8 grid gap-6 md:grid-cols-2">
			<div>
				<div
					class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Currently published
				</div>
				<div class="rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
					<ArticleBody html={data.parentArticle.bodyHtml} />
				</div>
			</div>
			<div>
				<div
					class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					Proposed
				</div>
				<div class="rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
					<ArticleBody html={data.renderedHtml} />
				</div>
			</div>
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
			class="mt-2 w-full rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
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
					class="mt-2 w-full rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
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
					class="mt-2 w-full rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)] disabled:opacity-40"
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

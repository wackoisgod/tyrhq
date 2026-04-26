<script lang="ts">
	let { data } = $props();

	const STATUS_CLASS: Record<string, string> = {
		pending: 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]',
		changes_requested: 'bg-[var(--hud-lime)]/15 text-[var(--hud-lime)]',
		approved: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]'
	};
</script>

<svelte:head>
	<title>Tyr HQ | Submission queue</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Reviewer
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Submission queue
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Open a submission to review the rendered preview before approving, requesting changes, or
		rejecting.
		{#if data.role === 'admin'}<span class="text-[var(--hud-teal)]"> Admin: you can review your own submissions.</span>{/if}
	</p>

	{#if data.submissions.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">Nothing in the queue.</p>
		</div>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.submissions as submission}
				<li
					class="rounded-sm bg-[var(--hud-panel)] p-5 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {STATUS_CLASS[submission.status] ?? ''}"
						>
							{submission.status.replace('_', ' ')}
						</span>
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{submission.type}
						</span>
						{#if submission.parent_article_id}
							<span
								class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
							>
								Suggested edit
							</span>
						{/if}
						<span class="text-xs text-[var(--hud-dim)]">
							Submitted {submission.submitted_at
								? new Date(submission.submitted_at).toLocaleString()
								: '—'}
						</span>
					</div>
					<a
						href="/admin/submissions/{submission.id}"
						class="mt-2 block font-[var(--font-display)] text-lg font-semibold text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
					>
						{submission.title || '(Untitled draft)'}
					</a>
					{#if submission.summary}
						<p class="mt-1 text-sm leading-6 text-[var(--hud-muted)]">{submission.summary}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

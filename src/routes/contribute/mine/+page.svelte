<script lang="ts">
	let { data } = $props();

	const STATUS_LABEL: Record<string, { label: string; className: string }> = {
		draft: { label: 'Draft', className: 'bg-[var(--hud-inset)] text-[var(--hud-muted)]' },
		pending: { label: 'In review', className: 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]' },
		changes_requested: {
			label: 'Changes requested',
			className: 'bg-[var(--hud-lime)]/15 text-[var(--hud-lime)]'
		},
		approved: { label: 'Approved', className: 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]' },
		published: {
			label: 'Published',
			className: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]'
		},
		rejected: { label: 'Rejected', className: 'bg-[var(--hud-inset)] text-[var(--hud-dim)]' }
	};

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Tyr HQ | My contributions</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Contribute
	</p>
	<div class="mt-2 flex flex-wrap items-end justify-between gap-3">
		<h1
			class="font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
		>
			My contributions
		</h1>
		<a href="/contribute/new" class="hud-cta px-5 py-3 text-sm">
			Write A New Article
		</a>
	</div>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Submit guides and articles directly from the site. Drafts save as you go; once you submit
		for review a contributor will publish it or send feedback.
	</p>

	{#if data.submissions.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">
				You haven't started any submissions yet. Hit the button above to write one.
			</p>
		</div>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.submissions as submission}
				{@const status = STATUS_LABEL[submission.status] ?? STATUS_LABEL.draft}
				<li
					class="rounded-sm bg-[var(--hud-panel)] p-5"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {status.className}"
						>
							{status.label}
						</span>
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{submission.type}
						</span>
						<span class="text-xs text-[var(--hud-dim)]">
							Updated {formatDate(submission.updated_at)}
						</span>
					</div>
					<div class="mt-2 flex flex-wrap items-baseline justify-between gap-3">
						<a
							href={submission.status === 'published' && submission.slug
								? `/${submission.type === 'guide' ? 'guides' : 'articles'}/${submission.slug}`
								: `/contribute/${submission.id}/edit`}
							class="font-[var(--font-display)] text-lg font-semibold text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
						>
							{submission.title || '(Untitled draft)'}
						</a>
						{#if submission.status !== 'published'}
							<a
								href="/contribute/{submission.id}/edit"
								class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
							>
								{submission.status === 'rejected' ? 'View' : 'Edit'} →
							</a>
						{/if}
					</div>
					{#if submission.summary}
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
							{submission.summary}
						</p>
					{/if}
					{#if submission.review_notes && (submission.status === 'changes_requested' || submission.status === 'rejected')}
						<div
							class="mt-3 rounded-sm border-l-2 border-[var(--hud-lime)] bg-[var(--hud-panel-mid)] p-3 text-sm text-[var(--hud-text)]"
						>
							<div
								class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
							>
								Reviewer notes
							</div>
							<p class="mt-1 whitespace-pre-wrap">{submission.review_notes}</p>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

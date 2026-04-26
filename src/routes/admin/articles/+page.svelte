<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	const STATUS_CLASS: Record<string, string> = {
		published: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]',
		withdrawn: 'bg-[var(--hud-lime)]/15 text-[var(--hud-lime)]',
		draft: 'bg-[var(--hud-inset)] text-[var(--hud-muted)]'
	};

	let busyId = $state<string | null>(null);
	let actionError = $state('');

	async function withdraw(id: string) {
		if (busyId) return;
		if (!window.confirm('Withdraw this article? It will 404 for everyone until you restore it.'))
			return;
		busyId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/articles/${id}/withdraw`, { method: 'POST' });
			if (!res.ok) {
				actionError = await res.text();
				return;
			}
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Withdraw failed.';
		} finally {
			busyId = null;
		}
	}

	async function restore(id: string) {
		if (busyId) return;
		busyId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/articles/${id}/restore`, { method: 'POST' });
			if (!res.ok) {
				actionError = await res.text();
				return;
			}
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Restore failed.';
		} finally {
			busyId = null;
		}
	}

	function publicHref(article: { type: 'guide' | 'article'; slug: string }) {
		return `/${article.type === 'guide' ? 'guides' : 'articles'}/${article.slug}`;
	}
</script>

<svelte:head>
	<title>Tyr HQ | Article moderation</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Admin
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		All articles
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Every guide and article in any status. Use Withdraw to take a row offline (it 404s for
		readers but stays in the database); Restore brings it back to Published.
	</p>

	{#if actionError}
		<p
			class="mt-6 rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]"
		>
			{actionError}
		</p>
	{/if}

	{#if data.articles.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No articles yet.</p>
		</div>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.articles as article}
				<li
					class="rounded-sm bg-[var(--hud-panel)] p-5"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {STATUS_CLASS[article.status] ?? ''}"
						>
							{article.status}
						</span>
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{article.type}
						</span>
						<span class="text-xs text-[var(--hud-dim)]">
							Updated {new Date(article.updatedAt).toLocaleDateString()}
						</span>
					</div>
					<div class="mt-2 flex flex-wrap items-baseline justify-between gap-3">
						<a
							href={publicHref(article)}
							class="font-[var(--font-display)] text-lg font-semibold text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
						>
							{article.title}
						</a>
						<div class="flex flex-wrap items-center gap-2">
							{#if article.status === 'published'}
								<button
									type="button"
									onclick={() => withdraw(article.id)}
									disabled={busyId === article.id}
									class="hud-cta-ghost px-4 py-2 text-xs disabled:opacity-50"
								>
									{busyId === article.id ? 'Working…' : 'Withdraw'}
								</button>
							{:else if article.status === 'withdrawn'}
								<button
									type="button"
									onclick={() => restore(article.id)}
									disabled={busyId === article.id}
									class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
								>
									{busyId === article.id ? 'Working…' : 'Restore'}
								</button>
							{/if}
						</div>
					</div>
					{#if article.summary}
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{article.summary}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

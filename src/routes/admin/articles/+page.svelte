<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { FLYOUT_SECTIONS, type FlyoutSection } from '$lib/content/flyout-sections';

	let { data } = $props();

	const STATUS_CLASS: Record<string, string> = {
		published: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]',
		withdrawn: 'bg-[var(--hud-lime)]/15 text-[var(--hud-lime)]',
		draft: 'bg-[var(--hud-inset)] text-[var(--hud-muted)]'
	};

	let busyId = $state<string | null>(null);
	let actionError = $state('');
	// Per-row pending edits; keyed by article id. Only synced to the server
	// when the admin clicks Save.
	let sectionEdits = $state<Record<string, FlyoutSection | ''>>({});
	let orderEdits = $state<Record<string, string>>({});

	function currentSection(article: {
		id: string;
		flyoutSection: FlyoutSection | null;
	}): FlyoutSection | '' {
		return sectionEdits[article.id] ?? article.flyoutSection ?? '';
	}

	function currentOrder(article: { id: string; flyoutOrder: number | null }): string {
		const edited = orderEdits[article.id];
		if (edited !== undefined) return edited;
		return article.flyoutOrder != null ? String(article.flyoutOrder) : '';
	}

	function isDirty(article: {
		id: string;
		flyoutSection: FlyoutSection | null;
		flyoutOrder: number | null;
	}): boolean {
		const sectionChanged =
			sectionEdits[article.id] !== undefined &&
			(sectionEdits[article.id] || null) !== article.flyoutSection;
		const orderChanged =
			orderEdits[article.id] !== undefined &&
			(orderEdits[article.id].trim() === ''
				? null
				: Number(orderEdits[article.id])) !== article.flyoutOrder;
		return sectionChanged || orderChanged;
	}

	async function saveFlyout(article: {
		id: string;
		flyoutSection: FlyoutSection | null;
		flyoutOrder: number | null;
	}) {
		if (busyId) return;
		const section = currentSection(article);
		const orderRaw = currentOrder(article);
		const orderNum = orderRaw.trim() === '' ? null : Number(orderRaw);
		if (orderNum != null && Number.isNaN(orderNum)) {
			actionError = 'Order must be a number.';
			return;
		}
		busyId = article.id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/articles/${article.id}/flyout`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					flyoutSection: section || null,
					flyoutOrder: section ? orderNum : null
				})
			});
			if (!res.ok) {
				actionError = await res.text();
				return;
			}
			delete sectionEdits[article.id];
			delete orderEdits[article.id];
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Save failed.';
		} finally {
			busyId = null;
		}
	}

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

	function publicHref(article: { type: 'guide' | 'article' | 'patch'; slug: string }) {
		const root =
			article.type === 'guide'
				? 'guides'
				: article.type === 'patch'
					? 'patch-notes'
					: 'articles';
		return `/${root}/${article.slug}`;
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

					{#if article.status === 'published'}
						<div
							class="mt-3 grid items-end gap-2 border-t border-[var(--hud-inset)] pt-3 sm:grid-cols-[1fr_120px_auto]"
						>
							<label class="flex flex-col gap-1">
								<span
									class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									Resources flyout section
								</span>
								<select
									value={currentSection(article)}
									onchange={(e) =>
										(sectionEdits[article.id] = (e.currentTarget as HTMLSelectElement)
											.value as FlyoutSection | '')}
									class="hud-input rounded-sm p-2 text-sm"
								>
									<option value="">— Not in flyout —</option>
									{#each FLYOUT_SECTIONS as section}
										<option value={section}>{section}</option>
									{/each}
								</select>
							</label>
							<label class="flex flex-col gap-1">
								<span
									class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									Order
								</span>
								<input
									type="number"
									step="1"
									placeholder="0"
									value={currentOrder(article)}
									oninput={(e) =>
										(orderEdits[article.id] = (e.currentTarget as HTMLInputElement).value)}
									disabled={!currentSection(article)}
									class="hud-input rounded-sm p-2 text-sm disabled:opacity-40"
								/>
							</label>
							<button
								type="button"
								onclick={() => saveFlyout(article)}
								disabled={busyId === article.id || !isDirty(article)}
								class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
							>
								{busyId === article.id ? 'Saving…' : 'Save'}
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<script lang="ts">
	import ArticlePageShell from '$lib/contribute/ArticlePageShell.svelte';
	import ArticleActionsBar from '$lib/contribute/ArticleActionsBar.svelte';

	let { data } = $props();
	let starredOverride = $state<boolean | null>(null);
	let starCountOverride = $state<number | null>(null);
	let starring = $state(false);

	const canToggleStar = $derived(Boolean(data.user) && data.patch.authorUserId !== data.user?.id);
	const starred = $derived(starredOverride ?? (data.userHasStarred ?? false));
	const starCount = $derived(starCountOverride ?? data.patch.starCount);

	$effect(() => {
		void data.patch.id;
		void data.userHasStarred;
		starredOverride = null;
		starCountOverride = null;
		starring = false;
	});

	async function toggleStar() {
		if (!canToggleStar || starring) return;

		starring = true;
		const previousStarred = starred;
		const previousCount = starCount;
		starredOverride = !previousStarred;
		starCountOverride = previousCount + (starredOverride ? 1 : -1);

		try {
			const response = await fetch('/api/articles/stars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ articleId: data.patch.id })
			});

			if (response.ok) {
				const result = await response.json();
				starredOverride = result.starred;
				starCountOverride = result.starCount;
			} else {
				starredOverride = previousStarred;
				starCountOverride = previousCount;
			}
		} catch {
			starredOverride = previousStarred;
			starCountOverride = previousCount;
		} finally {
			starring = false;
		}
	}
</script>

<ArticlePageShell
	type="patch"
	article={data.patch}
	contributors={data.contributors}
	historyHref={`/patch-notes/${data.patch.slug}/history`}
	backHref="/patch-notes"
	backLabel="Back To Patch Notes"
>
	{#snippet headerActions()}
		{#if canToggleStar}
			<button
				class="flex items-center gap-1.5 rounded-sm bg-[var(--hud-inset)] px-3 py-1.5 text-xs transition {starred ? 'shadow-[inset_2px_0_0_0_var(--hud-lime)]' : ''} hover:text-[var(--hud-teal)] disabled:opacity-60"
				onclick={toggleStar}
				disabled={starring}
				aria-pressed={starred}
				title={starred ? 'Remove star' : 'Star these patch notes'}
			>
				<svg
					class="h-3.5 w-3.5 transition {starred ? 'text-[var(--hud-lime)]' : 'text-[var(--hud-dim)]'}"
					viewBox="0 0 24 24"
					fill={starred ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
				</svg>
				<span class="font-mono text-[var(--hud-muted)]">{starCount}</span>
			</button>
		{:else if starCount > 0}
			<span
				class="flex items-center gap-1.5 rounded-sm bg-[var(--hud-inset)] px-3 py-1.5 text-xs shadow-[inset_0_0_0_1px_rgba(69,73,50,0.25)]"
			>
				<svg
					class="h-3.5 w-3.5 text-[var(--hud-lime)]"
					viewBox="0 0 24 24"
					fill="currentColor"
					stroke="none"
				>
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
				</svg>
				<span class="font-mono text-[var(--hud-muted)]">{starCount}</span>
			</span>
		{/if}
	{/snippet}

	{#snippet footer()}
		<ArticleActionsBar
			articleId={data.patch.id}
			articleType="patch"
			signedIn={Boolean(data.user)}
			canModerate={data.role === 'contributor' || data.role === 'admin'}
		/>
	{/snippet}
</ArticlePageShell>

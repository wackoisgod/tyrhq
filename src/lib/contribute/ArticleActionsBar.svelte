<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let {
		articleId,
		articleType,
		signedIn,
		canModerate
	}: {
		articleId: string;
		articleType: 'guide' | 'article' | 'patch';
		signedIn: boolean;
		canModerate: boolean;
	} = $props();

	function listingHref(type: 'guide' | 'article' | 'patch'): string {
		if (type === 'guide') return '/guides';
		if (type === 'patch') return '/patch-notes';
		return '/articles';
	}

	function typeLabel(type: 'guide' | 'article' | 'patch'): string {
		if (type === 'guide') return 'guide';
		if (type === 'patch') return 'patch note';
		return 'article';
	}

	let busy = $state(false);
	let error = $state('');

	async function startSuggestEdit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const res = await fetch(`/api/contribute/articles/${articleId}/suggest-edit`, {
				method: 'POST'
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			const { submissionId } = await res.json();
			await goto(`/contribute/${submissionId}/edit`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start an edit.';
		} finally {
			busy = false;
		}
	}

	async function withdraw() {
		if (busy) return;
		const label = typeLabel(articleType);
		if (
			!window.confirm(
				`Withdraw this ${label}? It will 404 for everyone until you restore it from /admin/articles.`
			)
		)
			return;
		busy = true;
		error = '';
		try {
			const res = await fetch(`/api/admin/articles/${articleId}/withdraw`, {
				method: 'POST'
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			await goto(listingHref(articleType));
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Withdraw failed.';
		} finally {
			busy = false;
		}
	}
</script>

{#if signedIn || canModerate}
	<div
		class="mt-8 flex flex-wrap items-center gap-2 border-t border-[var(--hud-variant)] pt-4"
	>
		{#if signedIn}
			<button
				type="button"
				onclick={startSuggestEdit}
				disabled={busy}
				class="hud-cta-ghost px-3 py-1.5 text-[11px] disabled:opacity-50"
			>
				Suggest An Edit
			</button>
		{/if}

		{#if canModerate}
			<button
				type="button"
				onclick={withdraw}
				disabled={busy}
				class="hud-cta-ghost px-3 py-1.5 text-[11px] disabled:opacity-50"
			>
				Withdraw
			</button>
		{/if}

		{#if error}
			<p class="text-[11px] text-[var(--hud-lime)]">{error}</p>
		{/if}
	</div>
{/if}

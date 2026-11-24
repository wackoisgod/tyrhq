<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();

	let loading = $state(false);
	let error = $state('');

	async function handleConfirmUndo() {
		loading = true;
		error = '';

		try {
			// User is confirming with their current session (primary account)
			// This proves they own the primary account
			const response = await fetch('/auth/unmerge/complete', {
				method: 'POST'
			});

			if (!response.ok) {
				const errorData = await response.json();
				error = errorData.message || 'Failed to undo merge. Please try again.';
				loading = false;
				return;
			}

			// Success - redirect to settings
			await invalidateAll();
			goto('/settings?success=merge_undone');
		} catch (err) {
			console.error('[unmerge] Error:', err);
			error = 'An unexpected error occurred. Please try again.';
			loading = false;
		}
	}

	function handleCancel() {
		goto('/settings');
	}
</script>

<svelte:head>
	<title>Tyr HQ | Confirm Undo Merge</title>
</svelte:head>

<section class="mx-auto max-w-2xl px-6 py-16">
	<div class="hud-panel p-8">
		<p class="hud-eyebrow tracking-[0.35em]">Account Security</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
		>
			Undo Account Merge
		</h1>

		<div class="mt-6 space-y-4 text-sm leading-6 text-[var(--hud-muted)]">
			<p>
				You're about to undo a merge and restore the secondary account.
			</p>

			<div class="rounded bg-[var(--hud-inset)] p-4">
				<p class="font-semibold text-[var(--hud-text)]">Merge details:</p>
				<ul class="mt-2 space-y-1">
					<li><strong>Secondary account:</strong> {data.secondaryEmail}</li>
					{#if data.secondaryName !== 'Unknown'}
						<li><strong>Display name:</strong> {data.secondaryName}</li>
					{/if}
					<li><strong>Merged:</strong> {new Date(data.mergedAt).toLocaleString()}</li>
				</ul>
			</div>

			<div class="rounded bg-[var(--hud-inset)] p-4">
				<p class="font-semibold text-[var(--hud-text)]">What happens:</p>
				<ul class="mt-2 list-inside list-disc space-y-1">
					<li>The secondary account will be restored and can be used to sign in</li>
					<li>Data moved during the merge will be returned to the secondary account</li>
					<li>Your primary account keeps any data it had before the merge</li>
					<li>Both accounts will exist separately again</li>
				</ul>
			</div>

			<p class="text-[var(--hud-warning)]">
				<strong>Warning:</strong> This cannot be undone again. If data was created after the merge that references moved data, conflicts may occur.
			</p>

			{#if error}
				<div
					class="border-l-2 border-[var(--hud-warning)] bg-[var(--hud-inset)] px-4 py-3 text-[var(--hud-warning)]"
				>
					{error}
				</div>
			{/if}
		</div>

		<div class="mt-8 flex gap-4">
			<button
				type="button"
				onclick={handleConfirmUndo}
				disabled={loading}
				class="hud-btn-primary flex-1"
			>
				{loading ? 'Undoing merge...' : 'Confirm Undo Merge'}
			</button>
			<button type="button" onclick={handleCancel} disabled={loading} class="hud-btn-secondary">
				Cancel
			</button>
		</div>
	</div>
</section>

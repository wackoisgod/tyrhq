<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	
	let { data } = $props();
	
	let merging = $state(false);
	let error = $state('');
	let success = $state(false);
	
	async function handleConfirmMerge() {
		merging = true;
		error = '';
		
		try {
			const response = await fetch('/auth/merge/complete', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			
			if (!response.ok) {
				const errorData = await response.json();
				error = errorData.message || 'Merge failed';
				merging = false;
				return;
			}
			
			const result = await response.json();
			success = true;
			
			// Wait 2 seconds then redirect to sign in
			setTimeout(() => {
				goto('/auth?merge_complete=1');
			}, 2000);
		} catch (err) {
			console.error('[merge-confirm] Exception:', err);
			error = 'An unexpected error occurred';
			merging = false;
		}
	}
	
	async function handleCancel() {
		try {
			await fetch('/auth/merge/cancel', {
				method: 'POST'
			});
			
			goto('/settings');
		} catch (err) {
			console.error('[merge-confirm] Exception cancelling:', err);
			goto('/settings');
		}
	}
</script>

<svelte:head>
	<title>Tyr HQ | Confirm Account Merge</title>
</svelte:head>

<section class="mx-auto max-w-md px-6 py-16">
	<div class="hud-panel p-8">
		<p class="hud-eyebrow tracking-[0.35em]">Account Merge</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
		>
			Confirm Merge
		</h1>
		
		{#if error}
			<div
				class="mt-4 border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
			>
				{error}
			</div>
		{/if}
		
		{#if success}
			<div
				class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]"
			>
				Accounts merged successfully! Redirecting to sign in...
			</div>
		{:else}
			<div class="mt-6 space-y-4">
				<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
					<p class="text-sm font-semibold text-[var(--hud-text)]">You're about to merge:</p>
					<div class="mt-3 space-y-2">
						<div class="rounded-sm bg-[var(--hud-inset)] p-3">
							<p class="text-xs font-semibold text-[var(--hud-muted)]">Secondary Account (will be deleted)</p>
							<p class="mt-1 text-sm text-[var(--hud-text)]">{data.secondaryEmail || 'Current account'}</p>
						</div>
						<div class="flex items-center justify-center">
							<svg class="w-6 h-6 text-[var(--hud-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
							</svg>
						</div>
						<div class="rounded-sm bg-[var(--hud-teal)]/10 border border-[var(--hud-teal)] p-3">
							<p class="text-xs font-semibold text-[var(--hud-teal)]">Primary Account (keeps everything)</p>
							<p class="mt-1 text-sm text-[var(--hud-text)]">{data.primaryEmail || 'Unknown'}</p>
						</div>
					</div>
				</div>
				
				<div class="rounded-sm bg-[var(--hud-warning)]/10 border border-[var(--hud-warning)] p-3">
					<p class="text-xs font-semibold text-[var(--hud-warning)]">⚠ Warning</p>
					<p class="mt-2 text-xs text-[var(--hud-muted)]">
						This action cannot be undone. All data from the secondary account will be moved to the primary account,
						and the secondary account will be permanently deleted.
					</p>
				</div>
				
				<div class="flex gap-3">
					<button
						type="button"
						class="hud-cta flex-1 px-4 py-3"
						onclick={handleConfirmMerge}
						disabled={merging}
					>
						{#if merging}
							Merging...
						{:else}
							Confirm Merge
						{/if}
					</button>
					<button
						type="button"
						class="hud-cta-outline px-4 py-3"
						onclick={handleCancel}
						disabled={merging}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

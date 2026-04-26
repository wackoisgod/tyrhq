<script lang="ts">
	import { getAbsoluteUrl } from '$lib/site-url';

	let { data } = $props();

	let deleting = $state<string | null>(null);
	let deleteError = $state<string | null>(null);
	let copiedSlug = $state<string | null>(null);

	const vehicleMap = $derived(
		new Map(data.vehicles.map((v: { id: string; name: string; classLabel: string }) => [v.id, v]))
	);

	async function deleteBuild(id: string) {
		if (!confirm('Delete this build? This cannot be undone.')) return;
		deleting = id;
		deleteError = null;
		try {
			const res = await fetch('/api/builds', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: 'Delete failed' }));
				deleteError = body.message ?? 'Delete failed';
				return;
			}
			// Remove from local list
			data.builds = data.builds.filter((b: { id: string }) => b.id !== id);
		} catch {
			deleteError = 'Network error — could not delete build.';
		} finally {
			deleting = null;
		}
	}

	async function copyShareLink(slug: string) {
		try {
			await navigator.clipboard.writeText(
				getAbsoluteUrl(`/builds/${slug}`, window.location.origin)
			);
			copiedSlug = slug;
			setTimeout(() => (copiedSlug = null), 2000);
		} catch {}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Tyr HQ | My Builds</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	{#if !data.authenticated}
		<div class="hud-panel p-8 text-center">
			<p class="hud-eyebrow tracking-[0.35em]">Restricted</p>
			<h1
				class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
			>
				Sign In Required
			</h1>
			<p class="mt-4 text-sm text-[var(--hud-muted)]">
				Sign in to view and manage your saved builds.
			</p>
			<a href="/auth" class="hud-cta mt-6 inline-block px-6 py-3">Sign In</a>
		</div>
	{:else}
		<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
			<div>
				<p
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					Arsenal
				</p>
				<h1
					class="font-[var(--font-display)] text-3xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
				>
					My Builds
				</h1>
			</div>
			<a href="/tools/builds" class="hud-cta px-5 py-2.5">New Build</a>
		</div>

		{#if deleteError}
			<div
				class="mb-4 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-2 text-sm text-[#ffd166]"
			>
				{deleteError}
			</div>
		{/if}

		{#if data.builds.length === 0}
			<div
				class="rounded-sm bg-[var(--hud-panel)] p-8 text-center"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				<p class="text-[var(--hud-muted)]">No saved builds yet.</p>
				<a
					href="/tools/builds"
					class="mt-4 inline-block text-sm text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
				>
					Open the Build Planner to create one
				</a>
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.builds as build (build.id)}
					{@const vehicle = vehicleMap.get(build.vehicle_id)}
					<div
						class="flex flex-col rounded-sm bg-[var(--hud-panel)] p-4"
						style="box-shadow: var(--hud-notch-shadow), var(--hud-surface-ghost);"
					>
						<div class="mb-3 flex items-start justify-between gap-2">
							<div class="min-w-0">
								<h2
									class="truncate font-[var(--font-display)] text-base font-semibold text-[var(--hud-text)]"
								>
									{build.title}
								</h2>
								<p class="mt-0.5 text-xs text-[var(--hud-muted)]">
									{vehicle?.name ?? build.vehicle_id}
									{#if vehicle}
										<span class="text-[var(--hud-dim)]">
											&middot; {vehicle.classLabel}
										</span>
									{/if}
								</p>
							</div>
							{#if build.is_public}
								<span
									class="shrink-0 rounded-sm bg-[var(--hud-teal)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--hud-on-gradient)]"
								>
									Public
								</span>
							{:else}
								<span
									class="shrink-0 rounded-sm bg-[var(--hud-panel-high)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--hud-dim)]"
								>
									Private
								</span>
							{/if}
						</div>

						<div class="mb-4 flex items-center gap-3">
							<p class="text-[11px] text-[var(--hud-dim)]">
								Updated {formatDate(build.updated_at)}
							</p>
							{#if build.is_public && build.star_count > 0}
								<span class="flex items-center gap-1 text-[11px]">
									<svg class="h-3 w-3 text-[var(--hud-lime)]" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
										<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
									</svg>
									<span class="font-mono text-[var(--hud-dim)]">{build.star_count}</span>
								</span>
							{/if}
						</div>

						<div class="mt-auto flex gap-2">
							<a
								href="/tools/builds?slug={build.slug}"
								class="hud-cta-ghost flex-1 px-3 py-2 text-center text-xs"
							>
								Edit
							</a>
							{#if build.is_public}
								<button
									class="hud-cta-outline px-3 py-2 text-xs"
									onclick={() => copyShareLink(build.slug)}
								>
									{copiedSlug === build.slug ? 'Copied!' : 'Copy Link'}
								</button>
							{/if}
							<button
								class="px-3 py-2 text-xs text-[var(--hud-muted)] transition hover:text-[#ffd166]"
								disabled={deleting === build.id}
								onclick={() => deleteBuild(build.id)}
							>
								{deleting === build.id ? '…' : 'Delete'}
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>

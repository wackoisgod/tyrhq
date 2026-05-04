<script lang="ts">
	let { data } = $props();

	function formatDate(iso: string): string {
		return iso.slice(0, 10);
	}
</script>

<svelte:head>
	<title>Tyr HQ | Patch Notes</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Field Manual
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Patch Notes
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Change logs and balance updates for Tyr, newest first. Versions reflect the build the notes
		were captured against.
	</p>

	{#if data.patches.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No patch notes yet. Check back soon.</p>
		</div>
	{:else}
		<div class="mt-8 flex flex-col gap-4">
			{#each data.patches as patch}
				<a
					href="/patch-notes/{patch.slug}"
					class="rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						{#if patch.isNew}
							<span class="tyr-new-pill">New</span>
						{/if}
						{#if patch.version}
							<span
								class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-teal)]"
							>
								{patch.version}
							</span>
						{/if}
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{formatDate(patch.publishedAt)}
						</span>
						{#if patch.tags?.length}
							{#each patch.tags as tag}
								<span
									class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
								>
									{tag}
								</span>
							{/each}
						{/if}
					</div>
					<h2
						class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]"
					>
						{patch.title}
					</h2>
					{#if patch.summary}
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{patch.summary}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</section>

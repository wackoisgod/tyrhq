<script lang="ts">
	let { data } = $props();

	function formatDate(iso: string): string {
		return iso.slice(0, 10);
	}
</script>

<svelte:head>
	<title>Tyr HQ | Guides</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Field Manual
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Guides
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Strategy, fundamentals, and chassis-specific tips. General topics first, then guides grouped by
		vehicle.
	</p>

	{#if data.general.length === 0 && data.vehicleGroups.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No guides yet. Check back soon.</p>
		</div>
	{:else}
		{#if data.general.length > 0}
			<div class="mt-8">
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					<span>General Guides</span>
					<span
						class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]"
					>
						FUNDAMENTALS
					</span>
				</div>

				<div class="flex flex-col gap-4">
					{#each data.general as guide}
						<a
							href="/guides/{guide.slug}"
							class="rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<div class="flex flex-wrap items-center gap-3">
								<span
									class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{formatDate(guide.publishedAt)}
								</span>
								{#if guide.tags?.length}
									{#each guide.tags as tag}
										<span
											class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
										>
											{tag}
										</span>
									{/each}
								{/if}
								{#if guide.starCount > 0}
									<span
										class="flex items-center gap-1 rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] text-[var(--hud-muted)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.25)]"
									>
										<svg class="h-3 w-3 text-[var(--hud-lime)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
											<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
										</svg>
										<span class="font-mono">{guide.starCount}</span>
									</span>
								{/if}
							</div>
							<h2
								class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]"
							>
								{guide.title}
							</h2>
							{#if guide.summary}
								<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{guide.summary}</p>
							{/if}
							{#if guide.authorDisplay}
								<p class="mt-3 text-xs text-[var(--hud-dim)]">By {guide.authorDisplay}</p>
							{/if}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		{#if data.vehicleGroups.length > 0}
			<div class="mt-12">
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					<span>Vehicle Guides</span>
					<span
						class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]"
					>
						BY CHASSIS
					</span>
				</div>

				<div class="flex flex-col gap-8">
					{#each data.vehicleGroups as group}
						<div>
							<div class="flex flex-wrap items-baseline justify-between gap-3">
								<a
									href="/tools/tanks/{group.slug}"
									class="font-[var(--font-display)] text-2xl font-semibold uppercase tracking-[0.04em] text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
								>
									{group.name}
								</a>
								<span
									class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{group.classLabel}
								</span>
							</div>

							<div class="mt-3 flex flex-col gap-3">
								{#each group.guides as guide}
									<a
										href="/guides/{guide.slug}"
										class="rounded-sm bg-[var(--hud-panel)] p-5 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
										style="box-shadow: var(--hud-surface-ghost);"
									>
										<div class="flex flex-wrap items-center gap-3">
											<span
												class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
											>
												{formatDate(guide.publishedAt)}
											</span>
											{#if guide.tags?.length}
												{#each guide.tags as tag}
													<span
														class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
													>
														{tag}
													</span>
												{/each}
											{/if}
											{#if guide.starCount > 0}
												<span
													class="flex items-center gap-1 rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] text-[var(--hud-muted)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.25)]"
												>
													<svg class="h-3 w-3 text-[var(--hud-lime)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
														<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
													</svg>
													<span class="font-mono">{guide.starCount}</span>
												</span>
											{/if}
										</div>
										<h3
											class="mt-2 font-[var(--font-display)] text-lg font-semibold text-[var(--hud-text)]"
										>
											{guide.title}
										</h3>
										{#if guide.summary}
											<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
												{guide.summary}
											</p>
										{/if}
									</a>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</section>

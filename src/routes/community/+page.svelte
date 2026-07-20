<script lang="ts">
	import { communityGroups } from '$lib/content/community';

	const groups = communityGroups.filter((group) => group.links.length > 0);

	function displayHost(href: string): string {
		try {
			return new URL(href).hostname.replace(/^www\./, '');
		} catch {
			return href;
		}
	}
</script>

<svelte:head>
	<title>Tyr HQ | Community</title>
	<meta
		name="description"
		content="Community Discords, fan sites, and tools for Tyr — official channels and player-run spaces in one place."
	/>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Comms Network
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Community
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Where the Tyr community gathers — official channels, player-run Discords, and fan-made sites
		and tools. Run a community space that belongs here? Reach out on Discord or open a pull
		request.
	</p>

	{#if groups.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No community links yet. Check back soon.</p>
		</div>
	{:else}
		{#each groups as group}
			<div class="mt-8">
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					<span>{group.heading}</span>
					{#if group.annotation}
						<span
							class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]"
						>
							{group.annotation}
						</span>
					{/if}
				</div>

				<div class="flex flex-col gap-4">
					{#each group.links as link}
						<a
							href={link.href}
							target="_blank"
							rel="noreferrer"
							class="rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<div class="flex flex-wrap items-center gap-3">
								{#if link.tag}
									<span
										class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
									>
										{link.tag}
									</span>
								{/if}
								<span
									class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{displayHost(link.href)}
								</span>
							</div>
							<h2
								class="mt-2 flex items-center gap-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]"
							>
								{link.label}
								<svg
									class="h-3.5 w-3.5 text-[var(--hud-dim)]"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="square"
									stroke-linejoin="miter"
									aria-hidden="true"
								>
									<path d="M7 17 17 7" />
									<path d="M9 7h8v8" />
								</svg>
							</h2>
							{#if link.description}
								<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{link.description}</p>
							{/if}
						</a>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</section>

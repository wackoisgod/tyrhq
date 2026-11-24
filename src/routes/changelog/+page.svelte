<script lang="ts">
	import { changelog, type ChangelogTag } from '$lib/changelog';

	const tagClass: Record<ChangelogTag, string> = {
		New: 'text-[var(--hud-teal)]',
		Improved: 'text-[var(--hud-text)]',
		Fixed: 'text-[var(--hud-muted)]'
	};

	function formatDate(iso: string): string {
		const [year, month, day] = iso.split('-').map(Number);
		return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
			timeZone: 'UTC',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Tyr HQ | Changelog</title>
	<meta name="description" content="Updates to Tyr HQ, newest first." />
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Field Manual
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Changelog
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Updates to Tyr HQ, newest first. Balance changes for the game itself are on
		<a href="/patch-notes" class="hud-link">Patch Notes</a>.
	</p>

	{#if changelog.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No updates yet. Check back soon.</p>
		</div>
	{:else}
		<div class="mt-8 flex flex-col gap-4">
			{#each changelog as entry (entry.date + entry.title)}
				<article
					class="rounded-sm bg-[var(--hud-panel)] p-6"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
						{formatDate(entry.date)}
					</p>
					<h2 class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]">
						{entry.title}
					</h2>
					<ul class="mt-4 flex flex-col gap-3">
						{#each entry.items as item}
							<li class="flex items-start gap-3 text-sm leading-6 text-[var(--hud-muted)]">
								<span
									class="mt-1 shrink-0 rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {tagClass[item.tag]}"
								>
									{item.tag}
								</span>
								<span>{item.text}</span>
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	{/if}
</section>

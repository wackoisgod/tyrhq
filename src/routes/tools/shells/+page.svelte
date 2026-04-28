<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';

	let { data } = $props();

	const GROUP_ORDER = new Map<string, number>([
		['Standard', 0],
		['Specialty', 1]
	]);

	type ListingShell = (typeof data.shells)[number];

	const groupedShells = $derived.by(() => {
		const grouped = new Map<string, ListingShell[]>();
		for (const shell of data.shells) {
			const items = grouped.get(shell.group) ?? [];
			items.push(shell);
			grouped.set(shell.group, items);
		}

		return [...grouped.entries()]
			.sort(
				(left, right) =>
					(GROUP_ORDER.get(left[0]) ?? 99) - (GROUP_ORDER.get(right[0]) ?? 99)
			)
			.map(
				([label, items]) =>
					[label, items.sort((left, right) => left.displayName.localeCompare(right.displayName))] as const
			);
	});

	function getGroupAccent(label: string) {
		switch (label) {
			case 'Standard':
				return { bar: 'bg-[var(--hud-teal)]', dot: 'bg-[var(--hud-teal)]/60' };
			case 'Specialty':
				return { bar: 'bg-[var(--hud-lime)]', dot: 'bg-[var(--hud-lime)]/60' };
			default:
				return { bar: 'bg-[var(--hud-purple-300)]', dot: 'bg-[var(--hud-purple-300)]/60' };
		}
	}

	function shellSubtitle(shell: ListingShell) {
		if (shell.id === 'standard' && shell.modifierCount === 0) return 'baseline';
		if (shell.modifierCount === 0) return 'no mods';
		return shell.modifierCount === 1 ? '1 mod' : `${shell.modifierCount} mods`;
	}
</script>

<svelte:head>
	<title>Tyr HQ | Shells</title>
	<meta
		name="description"
		content="Browse every shell in Tyr — see modifiers, slot availability, and which vehicles load each round by default."
	/>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<div class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="hud-telemetry-ribbon">
			<span>Shell Library · Compare every round before you load it</span>
			<span class="hud-numeric text-[10px] opacity-90">
				{data.shells.length} · {groupedShells.length} groups
			</span>
		</div>

		<div
			class="bg-[radial-gradient(circle_at_top,rgba(102,218,190,0.06),transparent_40%),linear-gradient(180deg,var(--hud-panel),var(--hud-surface))] px-4 py-5 md:px-6"
		>
			<div class="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
				<div>
					<p class="hud-eyebrow tracking-[0.34em]">Shell Database</p>
					<p class="mt-1.5 max-w-3xl text-xs leading-5 text-[var(--hud-muted)]">
						See what each shell modifies, whether it can ride the secondary slot, and which vehicles load it natively.
					</p>
				</div>
				<p class="hud-numeric shrink-0 text-xs text-[var(--hud-muted)]">
					{data.shells.length} shells · {groupedShells.length} groups
				</p>
			</div>

			{#each groupedShells as [label, shells]}
				{@const accent = getGroupAccent(label)}
				<div class="mb-1.5 mt-5 flex items-center gap-2.5 first:mt-0">
					<div class="h-2 w-2 rotate-45 {accent.dot}"></div>
					<h2
						class="font-[var(--font-display)] text-[11px] uppercase tracking-[0.3em] text-[var(--hud-text)]"
					>
						{label}
					</h2>
					<span class="hud-eyebrow text-[10px]">{shells.length}</span>
				</div>

				<div
					class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
				>
					{#each shells as shell}
						<a
							href={`/tools/shells/${shell.slug}`}
							class="group relative flex items-center gap-2.5 overflow-hidden rounded-sm bg-[var(--hud-panel-mid)] px-2.5 py-2 shadow-[0_2px_6px_rgba(0,0,0,0.22),inset_0_0_0_1px_rgba(69,73,50,0.2)] transition hover:shadow-[0_6px_18px_rgba(0,0,0,0.36),inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.3)] hover:brightness-110"
						>
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--hud-surface)]/80 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.10)]"
							>
								<FallbackImage
									src="/images/ammo/{shell.id}.png"
									alt=""
									kind="ammo"
									label={shell.displayName}
									class="h-7 w-7 object-contain"
								/>
							</div>
							<div class="min-w-0 flex-1">
								<div
									class="truncate font-[var(--font-display)] text-[12px] font-semibold uppercase leading-tight tracking-[0.04em] text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]"
								>
									{shell.displayName}
								</div>
								<div class="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--hud-dim)]">
									{shellSubtitle(shell)}{#if shell.canLoadSecondary}<span> · sec</span>{/if}
								</div>
							</div>
							<div class="absolute inset-y-0 right-0 w-0.5 {accent.bar} opacity-70"></div>
						</a>
					{/each}
				</div>
			{/each}
		</div>

		<div
			class="flex flex-wrap items-center justify-between gap-3 bg-[var(--hud-panel)] px-4 py-2.5 text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)] shadow-[inset_0_2px_0_0_rgba(102,218,190,0.12)] md:px-6"
		>
			<span>Select a shell to inspect modifiers and native vehicles</span>
			<span>{groupedShells.length} groups online</span>
		</div>
	</div>
</section>

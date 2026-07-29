<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DifficultyMeter from '$lib/components/DifficultyMeter.svelte';
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import {
		RATING_MAX,
		bestCompareValue,
		compareRatingRows,
		compareSections,
		formatCompareValue,
		scaleCompareValue,
		shouldShowCompareRow,
		type CompareRowDef
	} from '$lib/game-engine/tank-compare';
	import ScaleViewer from './ScaleViewer.svelte';

	let { data } = $props();

	type LoadedTank = (typeof data.tanks)[number];

	const MAX_COMPARE = 4;
	// One brand accent per comparison slot so a column, its meter fills and its
	// 3D model marker always read as the same vehicle — even when two tanks
	// share a class.
	const SLOT_ACCENTS = ['#99f7ff', '#d5ff01', '#be6cff', '#d8a361'];

	const tanksBySlug = $derived(new Map(data.tanks.map((tank) => [tank.slug, tank])));

	const groupedRoster = $derived.by(() => {
		const grouped = new Map<string, LoadedTank[]>();
		for (const tank of data.tanks) {
			const items = grouped.get(tank.classLabel) ?? [];
			items.push(tank);
			grouped.set(tank.classLabel, items);
		}

		const groupOrder = new Map([
			['Light', 0],
			['Medium', 1],
			['Heavy', 2]
		]);

		return [...grouped.entries()]
			.sort((left, right) => (groupOrder.get(left[0]) ?? 99) - (groupOrder.get(right[0]) ?? 99))
			.map(
				([group, items]) =>
					[group, items.sort((left, right) => left.name.localeCompare(right.name))] as const
			);
	});

	const selectedSlugs = $derived.by(() => {
		const raw = page.url.searchParams.get('tanks') ?? '';
		const seen = new Set<string>();
		const slugs: string[] = [];
		for (const part of raw.split(',')) {
			const slug = part.trim().toLowerCase();
			if (!slug || seen.has(slug) || !tanksBySlug.has(slug)) continue;
			seen.add(slug);
			slugs.push(slug);
			if (slugs.length >= MAX_COMPARE) break;
		}
		return slugs;
	});

	const selectedTanks = $derived(
		selectedSlugs.map((slug) => tanksBySlug.get(slug)).filter((tank): tank is LoadedTank => !!tank)
	);
	const hasComparison = $derived(selectedTanks.length >= 2);

	function applySelection(slugs: string[]) {
		const query = slugs.length > 0 ? `?tanks=${slugs.join(',')}` : '';
		goto(`/tools/tanks/compare${query}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function toggleTank(slug: string) {
		if (selectedSlugs.includes(slug)) {
			applySelection(selectedSlugs.filter((entry) => entry !== slug));
			return;
		}
		if (selectedSlugs.length >= MAX_COMPARE) return;
		applySelection([...selectedSlugs, slug]);
	}

	function rowValues(rowDef: CompareRowDef) {
		return selectedTanks.map((tank) => scaleCompareValue(rowDef, tank.stats[rowDef.key]));
	}

	function rowBarWidths(values: number[]) {
		// Proportional underbars only make sense for non-negative rows (gun
		// depression is negative); the highlight still marks the winner there.
		if (values.some((value) => value < 0)) return null;
		const max = Math.max(...values);
		if (max <= 0) return null;
		return values.map((value) => (value / max) * 100);
	}

	const ratingRows = $derived(
		compareRatingRows.map((rowDef) => {
			const values = rowValues(rowDef);
			return { rowDef, values, best: bestCompareValue(values, rowDef.better) };
		})
	);

	const statSections = $derived(
		compareSections
			.map((section) => ({
				...section,
				rows: section.rows
					.map((rowDef) => {
						const values = rowValues(rowDef);
						return {
							rowDef,
							values,
							best: bestCompareValue(values, rowDef.better),
							bars: rowBarWidths(values)
						};
					})
					.filter((entry) => shouldShowCompareRow(entry.values))
			}))
			.filter((section) => section.rows.length > 0)
	);

	const hasAbilityDetails = $derived(
		selectedTanks.some((tank) => tank.ability?.name || tank.ability?.description)
	);
</script>

<svelte:head>
	<title>Tyr HQ | Compare Tanks</title>
	<meta
		name="description"
		content="Compare Tyr tank stats side by side — firepower, mobility, stealth and real model scale."
	/>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<div class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
		<div class="hud-telemetry-ribbon">
			<span>Vehicle Comparison · Line up stats and scale before you commit to a hull</span>
			<span class="hud-numeric text-[10px] opacity-90">
				{selectedTanks.length} / {MAX_COMPARE} selected
			</span>
		</div>

		<div
			class="bg-[radial-gradient(circle_at_top,rgba(102,218,190,0.06),transparent_40%),linear-gradient(180deg,var(--hud-panel),var(--hud-surface))] px-4 py-6 md:px-6"
		>
			<div class="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<a
						href="/tools/tanks"
						class="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
					>
						<span
							aria-hidden="true"
							class="flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel-mid)] text-[var(--hud-lime)] transition group-hover:border-[var(--hud-lime)]/60 group-hover:bg-[var(--hud-lime)]/10"
						>
							<svg
								viewBox="0 0 16 16"
								class="h-3 w-3"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M10 3 5 8l5 5" />
							</svg>
						</span>
						Back To Vehicle Grid
					</a>
					<p class="hud-eyebrow mt-3 tracking-[0.34em]">Comparison Bay</p>
					<p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
						Pick two to four vehicles from the roster to line up their stats side by side.
						Highlighted values mark the best in each row, and the scale viewer below parks the
						actual models next to each other.
					</p>
				</div>
				{#if selectedTanks.length > 0}
					<button
						type="button"
						class="hud-cta-ghost shrink-0 px-4 py-2 text-xs"
						onclick={() => applySelection([])}
					>
						Clear Selection
					</button>
				{/if}
			</div>

			{#each groupedRoster as [group, tanks]}
				<div class="mb-2 mt-4 flex items-center gap-3 first:mt-0">
					<div class="h-2 w-2 rotate-45 bg-[var(--hud-teal)]/40"></div>
					<h2
						class="font-[var(--font-display)] text-[11px] uppercase tracking-[0.3em] text-[var(--hud-text)]"
					>
						{group}
					</h2>
				</div>
				<div class="flex flex-wrap gap-2">
					{#each tanks as tank}
						{@const slotIndex = selectedSlugs.indexOf(tank.slug)}
						{@const selected = slotIndex >= 0}
						{@const rosterFull = !selected && selectedSlugs.length >= MAX_COMPARE}
						<button
							type="button"
							onclick={() => toggleTank(tank.slug)}
							disabled={rosterFull}
							aria-pressed={selected}
							title={rosterFull
								? `Comparison is full (${MAX_COMPARE} max) — deselect a vehicle first`
								: selected
									? `Remove ${tank.name} from the comparison`
									: `Add ${tank.name} to the comparison`}
							class={`group flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left transition ${
								selected
									? 'bg-[var(--hud-panel-high)] shadow-[inset_0_0_0_1px_var(--slot-accent)]'
									: rosterFull
										? 'cursor-not-allowed bg-[var(--hud-panel-mid)] opacity-40 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.2)]'
										: 'bg-[var(--hud-panel-mid)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.2)] hover:brightness-110 hover:shadow-[inset_0_0_0_1px_rgba(153,247,255,0.35)]'
							}`}
							style={selected ? `--slot-accent: ${SLOT_ACCENTS[slotIndex]};` : undefined}
						>
							{#if selected}
								<span
									aria-hidden="true"
									class="h-2 w-2 rotate-45"
									style={`background: ${SLOT_ACCENTS[slotIndex]};`}
								></span>
							{/if}
							<FallbackImage
								src="/images/vehicles/{tank.id}.png"
								alt={tank.name}
								kind="vehicle"
								label={tank.name}
								class="h-7 w-11 object-contain"
							/>
							<span
								class={`text-[11px] font-semibold uppercase tracking-[0.08em] ${selected ? 'text-[var(--hud-text)]' : 'text-[var(--hud-muted)] group-hover:text-[var(--hud-text)]'}`}
							>
								{tank.name}
							</span>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	{#if !hasComparison}
		<div class="hud-panel-muted mt-4 p-8 text-center">
			<p class="hud-eyebrow tracking-[0.3em]">Awaiting Vehicles</p>
			<p class="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--hud-muted)]">
				{selectedTanks.length === 1
					? `${selectedTanks[0].name} is staged — pick at least one more vehicle from the roster above to start the comparison.`
					: 'Pick at least two vehicles from the roster above to line up their stats and size.'}
			</p>
		</div>
	{:else}
		<div class="mt-4 md:overflow-visible" style={`--compare-cols: ${selectedTanks.length};`}>
			<div class="overflow-x-auto md:overflow-x-visible">
				<div class="compare-min-width">
					<!-- Column headers -->
					<div
						class="compare-grid gap-2 border-b border-[var(--hud-variant)] bg-[var(--hud-surface)]/95 pb-2 backdrop-blur-sm md:sticky md:top-0 md:z-20"
					>
						<div class="flex items-end pb-1">
							<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
								Specs
							</span>
						</div>
						{#each selectedTanks as tank, index}
							<div
								class="relative overflow-hidden rounded-sm bg-[var(--hud-panel-mid)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)]"
							>
								<div
									class="absolute inset-x-0 top-0 h-[3px]"
									style={`background: ${SLOT_ACCENTS[index]};`}
								></div>
								<button
									type="button"
									class="absolute right-1.5 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-sm bg-[var(--hud-surface)]/80 text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
									onclick={() => toggleTank(tank.slug)}
									title={`Remove ${tank.name}`}
									aria-label={`Remove ${tank.name} from the comparison`}
								>
									<svg
										viewBox="0 0 16 16"
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
									>
										<path d="m4 4 8 8M12 4l-8 8" />
									</svg>
								</button>
								<div class="relative aspect-[16/8] overflow-hidden bg-[var(--hud-surface)]">
									<FallbackImage
										src="/images/vehicles/{tank.id}.png"
										alt={tank.name}
										kind="vehicle"
										label={tank.name}
										class="h-full w-full object-contain object-center drop-shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
									/>
									{#if tank.isWorkInProgress}
										<span
											class="absolute left-2 top-2 rounded-sm bg-[var(--hud-surface)]/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-lime)]"
											title="Alpha Program vehicle"
										>
											Alpha
										</span>
									{/if}
								</div>
								<div class="px-3 pb-2.5 pt-1.5">
									<div class="flex items-baseline justify-between gap-2">
										<a
											href={`/tools/tanks/${tank.slug}`}
											class="truncate font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
										>
											{tank.name}
										</a>
										<span class="shrink-0 text-[9px] uppercase tracking-[0.2em] text-[var(--hud-dim)]">
											{tank.classLabel}
										</span>
									</div>
									<div class="mt-1.5 flex gap-2.5 text-[9px] font-semibold uppercase tracking-[0.14em]">
										<a
											href={`/tools/tanks/${tank.slug}`}
											class="text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
										>
											Details
										</a>
										{#if tank.modelAvailable}
											<a
												href={`/tools/tanks/${tank.slug}/armor`}
												class="text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
											>
												Armor
											</a>
										{/if}
										<a
											href={`/tools/builds?vehicle=${tank.id}&locked=1`}
											class="text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
										>
											Build
										</a>
									</div>
								</div>
							</div>
						{/each}
					</div>

					<!-- Playstyle ratings -->
					<div class="mt-4">
						<div
							class="mb-2 flex items-center gap-3 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							<span>Playstyle Ratings</span>
							<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
								Official 0–{RATING_MAX} ratings · a quick read on what each hull is built for
							</span>
						</div>
						{#each ratingRows as { rowDef, values, best }}
							<div class="compare-grid items-center gap-2 py-1.5">
								<div class="text-[11px] uppercase tracking-[0.16em] text-[var(--hud-dim)]">
									{rowDef.label}
								</div>
								{#each values as value, index}
									{@const isBest = best != null && value === best}
									<div class="flex items-center gap-2 px-1">
										<div class="h-2 flex-1 rounded-sm bg-[var(--hud-inset)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.25)]">
											<div
												class="h-full rounded-sm"
												style={`width: ${Math.max(0, Math.min(100, (value / RATING_MAX) * 100))}%; background: ${isBest ? 'var(--hud-lime)' : SLOT_ACCENTS[index]}; opacity: ${isBest ? 1 : 0.55};`}
											></div>
										</div>
										<span
											class={`w-7 shrink-0 text-right font-mono text-[11px] tabular-nums ${isBest ? 'font-bold text-[var(--hud-lime)]' : 'text-[var(--hud-muted)]'}`}
										>
											{formatCompareValue(value)}
										</span>
									</div>
								{/each}
							</div>
						{/each}
						<div class="compare-grid items-center gap-2 py-1.5">
							<div class="text-[11px] uppercase tracking-[0.16em] text-[var(--hud-dim)]">
								Difficulty
							</div>
							{#each selectedTanks as tank}
								<div class="px-1">
									<DifficultyMeter value={tank.stats.DifficultyRating} size="sm" showValue />
								</div>
							{/each}
						</div>
					</div>

					<!-- Numeric stat sections -->
					{#each statSections as section}
						<div class="mt-5">
							<div
								class="mb-1 flex items-center gap-3 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
							>
								<span>{section.title}</span>
							</div>
							{#each section.rows as { rowDef, values, best, bars }}
								<div
									class="compare-grid items-center gap-2 border-b border-[rgba(69,73,50,0.16)] py-2 last:border-b-0"
								>
									<div
										class="text-[11px] uppercase tracking-[0.16em] text-[var(--hud-dim)]"
										title={rowDef.hint}
									>
										{rowDef.label}{#if rowDef.hint}<span
												class="ml-1 cursor-help text-[var(--hud-teal)]/70">ⓘ</span
											>{/if}
									</div>
									{#each values as value, index}
										{@const isBest = best != null && value === best}
										<div class="px-1">
											<div class="flex items-baseline gap-1">
												<span
													class={`font-mono text-sm tabular-nums ${isBest ? 'font-bold text-[var(--hud-lime)]' : 'text-[var(--hud-text)]'}`}
												>
													{formatCompareValue(value)}
												</span>
												{#if rowDef.unit}
													<span class="text-[9px] uppercase text-[var(--hud-dim)]">{rowDef.unit}</span>
												{/if}
											</div>
											{#if bars}
												<div class="mt-1 h-[3px] w-full max-w-[9rem] bg-[var(--hud-inset)]">
													<div
														class="h-full"
														style={`width: ${bars[index]}%; background: ${isBest ? 'var(--hud-lime)' : SLOT_ACCENTS[index]}; opacity: ${isBest ? 1 : 0.5};`}
													></div>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						</div>
					{/each}

					<!-- Abilities -->
					{#if hasAbilityDetails}
						<div class="mt-5">
							<div
								class="mb-2 flex items-center gap-3 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
							>
								<span>Commander Abilities</span>
								<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
									Abilities are unique per hull — read them as playstyle, not numbers
								</span>
							</div>
							<div class="compare-grid gap-2">
								<div></div>
								{#each selectedTanks as tank}
									<div
										class="rounded-sm bg-[var(--hud-panel-mid)] p-3 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)]"
									>
										<div class="flex items-center gap-2.5">
											<div
												class="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-[var(--hud-inset)]"
											>
												<FallbackImage
													src="/images/abilities/{tank.id}.png"
													alt="{tank.name} ability"
													kind="ability"
													label="{tank.name} ability"
													class="h-7 w-7 object-contain"
												/>
											</div>
											<div class="min-w-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--hud-text)]">
												{tank.ability?.name || 'Commander Ability'}
											</div>
										</div>
										{#if tank.ability?.description}
											<p class="mt-2 text-xs leading-5 text-[var(--hud-muted)]">
												{tank.ability.description}
											</p>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Model scale comparison -->
		<div class="mt-8">
			<div
				class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Scale Check</span>
				<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
					IN-GAME MODELS · TRUE RELATIVE SIZE
				</span>
			</div>
			<ScaleViewer
				tanks={selectedTanks.map((tank, index) => ({
					id: tank.id,
					name: tank.name,
					classLabel: tank.classLabel,
					accent: SLOT_ACCENTS[index],
					modelAvailable: tank.modelAvailable
				}))}
			/>
		</div>
	{/if}
</section>

<style>
	.compare-grid {
		display: grid;
		grid-template-columns: minmax(7.5rem, 0.9fr) repeat(var(--compare-cols, 2), minmax(0, 1fr));
	}

	/* Keep columns readable on small screens; the wrapper scrolls horizontally. */
	.compare-min-width {
		min-width: calc(8rem + var(--compare-cols, 2) * 11rem);
	}

	@media (min-width: 768px) {
		.compare-min-width {
			min-width: 0;
		}
	}
</style>

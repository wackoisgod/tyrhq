<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import type { TankSummary } from '$lib/types/game';

	let { data } = $props();
	const groupedTanks = $derived.by(() => {
		const grouped = new Map<string, TankSummary[]>();
		for (const tank of data.tanks as TankSummary[]) {
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
			.map(([group, items]) => [group, items.sort((left, right) => left.name.localeCompare(right.name))] as const);
	});

	function formatCardValue(value: number | undefined) {
		if (value == null) return '0';
		return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, '');
	}

	function getTankTheme(tank: TankSummary) {
		if (tank.classId === 'heavy') {
			return {
				panel:
					'background: linear-gradient(140deg, rgba(102,218,190,0.12) 0%, rgba(24,28,37,0.92) 44%, rgba(10,14,23,0.98) 100%);',
				accent: 'text-[var(--hud-teal)]',
				chip: 'border-[var(--hud-teal)]/35 bg-[var(--hud-teal)]/10 text-[var(--hud-text)]',
				line: 'bg-[var(--hud-lime)]',
				glow: 'rgba(102, 218, 190, 0.15)'
			};
		}

		if (tank.classId === 'light') {
			return {
				panel:
					'background: linear-gradient(140deg, rgba(202,242,0,0.1) 0%, rgba(24,28,37,0.9) 44%, rgba(10,14,23,0.98) 100%);',
				accent: 'text-[var(--hud-lime)]',
				chip: 'border-[var(--hud-lime)]/40 bg-[var(--hud-lime)]/10 text-[var(--hud-text)]',
				line: 'bg-[var(--hud-teal)]',
				glow: 'rgba(202, 242, 0, 0.12)'
			};
		}

		return {
			panel:
				'background: linear-gradient(140deg, rgba(102,218,190,0.08) 0%, rgba(24,28,37,0.9) 44%, rgba(10,14,23,0.98) 100%);',
			accent: 'text-[var(--hud-muted)]',
			chip: 'border-[color:rgba(143,147,120,0.45)] bg-[var(--hud-panel-mid)] text-[var(--hud-text)]',
			line: 'bg-[var(--hud-teal)]',
			glow: 'rgba(102, 218, 190, 0.12)'
		};
	}
</script>

<svelte:head>
	<title>Tyr HQ | Tanks</title>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-10 md:px-6">
	<div
		class="hud-panel overflow-hidden rounded-sm shadow-[0_24px_48px_rgba(0,0,0,0.4)]"
	>
		<div class="hud-telemetry-ribbon">
			<span>Vehicle Select · Choose a vehicle to inspect armor and start a build</span>
			<span class="hud-numeric text-[10px] opacity-90">{data.tanks.length} · {groupedTanks.length} classes</span>
		</div>

		<div
			class="bg-[radial-gradient(circle_at_top,rgba(102,218,190,0.06),transparent_40%),linear-gradient(180deg,var(--hud-panel),var(--hud-surface))] px-4 py-6 md:px-6"
		>
			<div class="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<p class="hud-eyebrow tracking-[0.34em]">Vehicle Database</p>
					<p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
						Open a vehicle page from this roster, then jump directly into the build planner with that
						vehicle preselected.
					</p>
				</div>
				<p class="hud-numeric shrink-0 text-sm text-[var(--hud-muted)]">
					{data.tanks.length} vehicles · {groupedTanks.length} classes
				</p>
			</div>

			{#each groupedTanks as [group, tanks]}
				<div class="mb-2 mt-6 flex items-center gap-3 first:mt-0">
					<div class="h-2.5 w-2.5 rotate-45 bg-[var(--hud-teal)]/40"></div>
					<h2 class="font-[var(--font-display)] text-xs uppercase tracking-[0.3em] text-[var(--hud-text)]">
						{group}
					</h2>
					<span class="hud-eyebrow">{tanks.length} vehicles</span>
				</div>

				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{#each tanks as tank}
						<a
							href={`/tools/tanks/${tank.slug}`}
							class="group relative block overflow-hidden rounded-sm bg-[var(--hud-panel-mid)] shadow-[0_2px_8px_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(69,73,50,0.2)] transition hover:shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.3)] hover:brightness-110"
						>
							<div
								class="relative aspect-[16/10] overflow-hidden bg-[var(--hud-surface)]"
							>
								<div
									class="absolute inset-0"
									style={getTankTheme(tank).panel}
								></div>
								<FallbackImage
									src="/images/vehicles/{tank.id}.png"
									alt={tank.name}
									kind="vehicle"
									label={tank.name}
									class="relative h-full w-full object-contain object-center drop-shadow-[0_6px_20px_rgba(0,0,0,0.5)] transition group-hover:scale-105"
								/>
								<div
									class="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--hud-panel-mid)] to-transparent"
								></div>
								<div
									class="absolute right-2 top-2 rounded-sm bg-[var(--hud-surface)]/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-muted)] backdrop-blur-sm"
								>
									{tank.classLabel}
								</div>
							</div>
							<div class="px-3 py-2.5">
								<div
									class="font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)]"
								>
									{tank.name}
								</div>
								<div class="mt-1 flex gap-3 font-mono text-[10px] tabular-nums text-[var(--hud-dim)]">
									<span>DMG <span class="text-[var(--hud-muted)]">{formatCardValue(tank.stats.damage)}</span></span>
									<span>PEN <span class="text-[var(--hud-muted)]">{formatCardValue(tank.stats.penetration)}</span></span>
									<span>SPD <span class="text-[var(--hud-muted)]">{formatCardValue(tank.stats.maxSpeed)}</span></span>
								</div>
							</div>
							{#if tank.isWorkInProgress}
								<div
									class="alpha-program-chip absolute bottom-2 right-2"
									title="Alpha Program vehicle"
									aria-label="Alpha Program vehicle"
								>
									<span class="alpha-program-chip__label">Alpha</span>
									<span class="alpha-program-chip__mark">
										<span class="alpha-program-chip__icon" aria-hidden="true"></span>
									</span>
								</div>
							{/if}
							<div class={`h-1 ${getTankTheme(tank).line}`}></div>
						</a>
					{/each}
				</div>
			{/each}
		</div>

		<div
			class="flex flex-wrap items-center justify-between gap-3 bg-[var(--hud-panel)] px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)] shadow-[inset_0_2px_0_0_rgba(102,218,190,0.12)] md:px-6"
		>
			<span>Select a vehicle to inspect armor and start a build</span>
			<span>{groupedTanks.length} classes online</span>
		</div>
	</div>
</section>

<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import type { TankSummary } from '$lib/types/game';

	let { data } = $props();

	const statRows = $derived([
		{ label: 'Health', value: data.tank.stats.health, unit: '' },
		{ label: 'Max Speed', value: data.tank.stats.maxSpeed, unit: 'kph' },
		{ label: 'Reverse Speed', value: data.tank.stats.reverseSpeed, unit: 'kph' },
		{ label: 'Damage', value: data.tank.stats.damage, unit: '' },
		{ label: 'Penetration', value: data.tank.stats.penetration, unit: '' },
		{ label: 'Reload', value: data.tank.stats.reloadTime, unit: 's' },
		{ label: 'Vision', value: data.tank.stats.vision, unit: 'm' },
		{ label: 'Detection', value: data.tank.stats.detection, unit: 'm' },
		{ label: 'Camo', value: data.tank.stats.camo, unit: '%' }
	]);

	function formatValue(value: number | undefined, unit: string) {
		if (value == null) return '0';
		return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')}${unit ? ` ${unit}` : ''}`;
	}

	function getTankTheme(tank: TankSummary) {
		if (tank.classId === 'heavy') {
			return {
				panel:
					'background: linear-gradient(135deg, rgba(102,218,190,0.18) 0%, rgba(24,28,41,0.92) 52%, rgba(10,14,23,0.98) 100%);',
				accent: 'text-[var(--hud-teal)]',
				chip: 'border-[var(--hud-teal)]/35 bg-[var(--hud-teal)]/10 text-[var(--hud-text)]'
			};
		}

		if (tank.classId === 'light') {
			return {
				panel:
					'background: linear-gradient(135deg, rgba(202,242,0,0.16) 0%, rgba(24,28,41,0.9) 48%, rgba(10,14,23,0.98) 100%);',
				accent: 'text-[var(--hud-lime)]',
				chip: 'border-[var(--hud-lime)]/35 bg-[var(--hud-lime)]/12 text-[var(--hud-text)]'
			};
		}

		return {
			panel:
				'background: linear-gradient(135deg, rgba(102,218,190,0.12) 0%, rgba(24,28,41,0.9) 50%, rgba(10,14,23,0.98) 100%);',
			accent: 'text-[var(--hud-muted)]',
			chip: 'border-[color:rgba(143,147,120,0.45)] bg-[var(--hud-panel-mid)] text-[var(--hud-text)]'
		};
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.tank.name}</title>
</svelte:head>

<section class="mx-auto max-w-7xl px-6 py-16">
	<div class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
		<div>
			<a
				href="/tools/tanks"
				class="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
			>
				Back To Vehicle Grid
			</a>

			<div
				class="relative mt-4 aspect-[16/9] overflow-hidden rounded-sm border border-[rgba(69,73,50,0.4)]"
				style={getTankTheme(data.tank).panel}
			>
				<div
					class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(102,218,190,0.12),transparent_35%)]"
				></div>
				<div class="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:24px_24px]"></div>
				<FallbackImage
					src="/images/vehicles/{data.tank.id}.png"
					alt={data.tank.name}
					kind="vehicle"
					label={data.tank.name}
					class="absolute inset-0 h-full w-full object-contain object-center drop-shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
				/>
				<div
					class="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[var(--hud-inset)] via-[var(--hud-inset)]/80 to-transparent"
				></div>

				<div class="absolute left-5 right-5 top-5 flex items-start justify-between">
					<div class={`text-xs uppercase tracking-[0.32em] ${getTankTheme(data.tank).accent}`}>
						{data.tank.classLabel} vehicle
					</div>
					{#if data.armorAvailable}
						<a
							href={`/tools/tanks/${data.tank.slug}/armor`}
							class="rounded-sm bg-[var(--hud-panel)]/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.4)] backdrop-blur-sm transition hover:bg-[var(--hud-panel)] hover:text-[var(--hud-lime)]"
						>
							Inspect Armor
						</a>
					{:else}
						<span
							class="rounded-sm bg-[var(--hud-panel)]/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-dim)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.4)] backdrop-blur-sm"
							title="Armor viewer assets are not published for this vehicle yet."
						>
							Armor Data Pending
						</span>
					{/if}
				</div>

				<div class="absolute inset-x-5 bottom-5">
					<h1
						class="font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)] md:text-5xl"
					>
						{data.tank.name}
					</h1>
				</div>
			</div>
		</div>

		<div class="flex flex-col">
			<div
				class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Specs</span>
				<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
					BASE_STATS · {data.tank.classLabel}
				</span>
			</div>
			<div class="grid flex-1 gap-2 sm:grid-cols-3">
				{#each statRows as stat}
					<div class="rounded-sm bg-[var(--hud-panel-mid)] p-3 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)]">
						<div class="text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">{stat.label}</div>
						<div class="mt-1 text-xl font-semibold text-[var(--hud-text)]">
							{formatValue(stat.value, stat.unit)}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<section id="build-library" class="mt-4">
		<div
			class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
		>
			<span>Builds</span>
			<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
				COMMUNITY · {data.tank.name}
			</span>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-4">
			<h2 class="font-[var(--font-display)] text-2xl font-semibold uppercase text-[var(--hud-text)]">
				Build Library
			</h2>
			<a href={`/tools/builds?vehicle=${data.tank.id}&locked=1`} class="hud-cta px-4 py-2 text-sm">
				Create Build
			</a>
		</div>

		<div class="mt-4">
			{#if data.publicBuilds.length > 0}
				<div class="grid gap-3 sm:grid-cols-2">
					{#each data.publicBuilds as build}
						{@const componentIds = (build.selection?.componentIds ?? []).filter(Boolean).filter((id) => data.componentNames[id])}
						{@const ammoIds = (build.selection?.ammoIds ?? []).filter((id) => id && id !== 'standard' && data.ammoNames[id])}
						{@const creatorName = Array.isArray(build.profiles) ? build.profiles[0]?.display_name : build.profiles?.display_name}
						<a
							href="/tools/builds?slug={build.slug}"
							class="group flex flex-col rounded-sm bg-[var(--hud-panel-mid)] p-4 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)] transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.22)]"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="truncate font-semibold text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]">
										{build.title}
									</div>
									<div class="mt-1 text-[11px] text-[var(--hud-dim)]">
										{#if creatorName}
											<span class="text-[var(--hud-muted)]">{creatorName}</span>
											<span class="mx-1">·</span>
										{/if}
										{new Date(build.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
									</div>
								</div>
								{#if build.star_count > 0}
									<span class="flex shrink-0 items-center gap-1 rounded-sm bg-[var(--hud-inset)] px-2 py-1 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.25)]">
										<svg class="h-3 w-3 text-[var(--hud-lime)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
											<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
										</svg>
										<span class="font-mono text-[11px] text-[var(--hud-muted)]">{build.star_count}</span>
									</span>
								{/if}
							</div>
							{#if componentIds.length > 0 || ammoIds.length > 0}
								<div class="mt-3 flex items-center gap-1.5">
									{#each componentIds as id}
										<FallbackImage src="/images/components/{id}.png" alt={data.componentNames[id]} title={data.componentNames[id]} kind="component" label={data.componentNames[id] ?? id} class="h-6 w-6 object-contain opacity-80" />
									{/each}
									{#each ammoIds as id}
										<FallbackImage src="/images/ammo/{id}.png" alt={data.ammoNames[id]} title={data.ammoNames[id]} kind="ammo" label={data.ammoNames[id] ?? id} class="h-6 w-6 object-contain opacity-80" />
									{/each}
								</div>
							{/if}
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-[var(--hud-muted)]">
					No community builds for {data.tank.name} yet. Be the first to share one.
				</p>
			{/if}
		</div>
	</section>

	<div class="mt-8 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
		{#if data.nativeComponents.length > 0}
			<section class="hud-panel p-6">
				<h2 class="font-[var(--font-display)] text-3xl font-semibold uppercase text-[var(--hud-text)]">
					Native Components
				</h2>
				<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">
					Components unlocked by leveling {data.tank.name}. These are earned through vehicle progression and
					cannot be purchased.
				</p>

				<div class="mt-6 grid gap-4">
					{#each data.nativeComponents as nc}
						<a
							href={`/tools/components/${nc.slug}`}
							class="group block rounded-sm bg-[var(--hud-inset)] p-5 shadow-[inset_2px_0_0_0_var(--hud-lime),inset_0_0_0_1px_var(--hud-ghost)] transition hover:shadow-[inset_2px_0_0_0_var(--hud-lime),inset_0_0_0_1px_rgba(153,247,255,0.32)]"
						>
							<div class="flex items-start justify-between gap-4">
								<div>
									<div
										class="font-semibold text-[var(--hud-text)] transition group-hover:text-[var(--hud-teal)]"
									>
										{nc.name}
									</div>
									<div class="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--hud-dim)]">
										{nc.category}
									</div>
									<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{nc.description}</p>
								</div>
								<div
									class="shrink-0 rounded-sm bg-[var(--hud-lime)]/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-lime)]"
								>
									Level {nc.level}
								</div>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<section class="hud-panel p-6">
			<h2 class="font-[var(--font-display)] text-3xl font-semibold uppercase text-[var(--hud-text)]">
				Related {data.tank.classLabel}s
			</h2>
			<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">
				Jump between similar chassis before committing to a build path.
			</p>

			<div class="mt-5 grid gap-3">
				{#each data.relatedVehicles as vehicle}
					<a
						href={`/tools/tanks/${vehicle.slug}`}
						class="hud-panel-muted p-4 transition hover:shadow-[inset_3px_0_0_0_var(--hud-teal)]"
					>
						<div class="flex items-center justify-between gap-4">
							<div>
								<div class="font-semibold text-[var(--hud-text)]">{vehicle.name}</div>
								<div class="mt-1 text-sm text-[var(--hud-muted)]">
									{formatValue(vehicle.stats.damage, '')} damage • {formatValue(vehicle.stats.maxSpeed, 'kph')}
								</div>
							</div>
							<div class="hud-eyebrow">Open</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	</div>
</section>

<script lang="ts">
	import { onMount } from 'svelte';
	import FallbackImage from '$lib/components/FallbackImage.svelte';

	let { data } = $props();

	const MODIFIER_LABELS: Record<string, string> = {
		damage: 'Damage',
		penetration: 'Penetration',
		reload: 'Reload',
		dispersion: 'Dispersion',
		detection: 'Detection',
		velocity: 'Velocity',
		maxSpeed: 'Top Speed',
		reverseSpeed: 'Reverse',
		strafeSpeed: 'Strafe'
	};

	// For most modifiers, > 1 is a buff. For reload, dispersion, detection, > 1 is a debuff
	// (slower reload, worse spread, easier to spot). Speeds: faster is better.
	const HIGHER_IS_BETTER: Record<string, boolean> = {
		damage: true,
		penetration: true,
		reload: false,
		dispersion: false,
		detection: false,
		velocity: true,
		maxSpeed: true,
		reverseSpeed: true,
		strafeSpeed: true
	};

	type StatKey = keyof (typeof data.vehicles)[number]['base'];

	const STAT_KEY: Record<string, StatKey | null> = {
		damage: 'damage',
		penetration: 'penetration',
		reload: 'reload',
		velocity: 'velocity',
		detection: 'detection',
		dispersion: null,
		maxSpeed: 'maxSpeed',
		reverseSpeed: 'reverseSpeed',
		strafeSpeed: 'strafeSpeed'
	};

	const PREVIEW_STORAGE_KEY = 'tyr.shellPreviewVehicle';

	function getGroupAccent(label: string) {
		switch (label) {
			case 'Standard':
				return { text: 'text-[var(--hud-teal)]', bar: 'bg-[var(--hud-teal)]' };
			case 'Specialty':
				return { text: 'text-[var(--hud-lime)]', bar: 'bg-[var(--hud-lime)]' };
			default:
				return { text: 'text-[var(--hud-muted)]', bar: 'bg-[var(--hud-purple-300)]' };
		}
	}

	const accent = $derived(getGroupAccent(data.group));

	function formatDelta(value: number) {
		const pct = Math.round((value - 1) * 100);
		if (pct === 0) return '—';
		return pct > 0 ? `+${pct}%` : `${pct}%`;
	}

	function formatStat(key: string, value: number) {
		if (key === 'reload') return `${value.toFixed(1)} s`;
		if (key === 'velocity') return `${Math.round(value)} m/s`;
		if (key === 'detection') return `${Math.round(value)} m`;
		if (key === 'maxSpeed' || key === 'reverseSpeed' || key === 'strafeSpeed')
			return `${Math.round(value)} kph`;
		return Math.round(value).toString();
	}

	function modifierTone(key: string, value: number) {
		if (value === 1) return 'text-[var(--hud-dim)]';
		const higherIsBetter = HIGHER_IS_BETTER[key] ?? true;
		const isBuff = higherIsBetter ? value > 1 : value < 1;
		return isBuff ? 'text-emerald-300' : 'text-rose-300';
	}

	const modifierEntries = $derived(
		Object.entries(data.shell.modifiers) as [keyof typeof data.shell.modifiers, number][]
	);

	const activeModifiers = $derived(modifierEntries.filter(([, value]) => value !== 1));

	let selectedVehicleId = $state<string>('');
	let hydrated = $state(false);
	let tankModalOpen = $state(false);
	let tankSearchQuery = $state('');

	const selectedVehicle = $derived(
		data.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null
	);

	const groupedTanks = $derived.by(() => {
		const query = tankSearchQuery.trim().toLowerCase();
		const matches = query
			? data.vehicles.filter((vehicle) => vehicle.name.toLowerCase().includes(query))
			: data.vehicles;
		const grouped = new Map<string, typeof matches>();
		for (const vehicle of matches) {
			const items = grouped.get(vehicle.classLabel) ?? [];
			items.push(vehicle);
			grouped.set(vehicle.classLabel, items);
		}
		const order = ['Light', 'Medium', 'Heavy'];
		return [...grouped.entries()].sort(
			(left, right) => (order.indexOf(left[0]) + 99) - (order.indexOf(right[0]) + 99)
		);
	});

	function openTankModal() {
		tankSearchQuery = '';
		tankModalOpen = true;
	}

	function closeTankModal() {
		tankModalOpen = false;
	}

	function pickTank(id: string) {
		selectedVehicleId = id;
		closeTankModal();
	}

	function handleModalKey(event: KeyboardEvent) {
		if (event.key === 'Escape') closeTankModal();
	}

	onMount(() => {
		const stored = localStorage.getItem(PREVIEW_STORAGE_KEY);
		if (stored && data.vehicles.some((vehicle) => vehicle.id === stored)) {
			selectedVehicleId = stored;
		}
		hydrated = true;
	});

	$effect(() => {
		if (!hydrated) return;
		if (selectedVehicleId) {
			localStorage.setItem(PREVIEW_STORAGE_KEY, selectedVehicleId);
		} else {
			localStorage.removeItem(PREVIEW_STORAGE_KEY);
		}
	});

	$effect(() => {
		if (!tankModalOpen) return;
		window.addEventListener('keydown', handleModalKey);
		return () => window.removeEventListener('keydown', handleModalKey);
	});
</script>

<svelte:head>
	<title>Tyr HQ | {data.shell.displayName}</title>
	<meta
		name="description"
		content={data.shell.description.length > 0
			? data.shell.description
			: `${data.shell.displayName} — ${data.group} shell for Tyr.`}
	/>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<a
		href="/tools/shells"
		class="group inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
	>
		<span
			aria-hidden="true"
			class="flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel-mid)] text-[var(--hud-lime)] transition group-hover:border-[var(--hud-lime)]/60 group-hover:bg-[var(--hud-lime)]/10"
		>
			<svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M10 3 5 8l5 5" />
			</svg>
		</span>
		Back To Shells
	</a>

	<div
		class="mt-3 flex items-center gap-4 rounded-sm bg-[var(--hud-panel)] p-4 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12),0_18px_36px_rgba(0,0,0,0.22)]"
	>
		<div class="h-12 w-1 shrink-0 {accent.bar}"></div>
		<div
			class="flex h-16 w-16 shrink-0 items-center justify-center bg-[var(--hud-inset)] shadow-[inset_0_0_0_1px_rgba(160,170,217,0.10)]"
		>
			<FallbackImage
				src="/images/ammo/{data.shell.id}.png"
				alt={data.shell.displayName}
				kind="ammo"
				label={data.shell.displayName}
				class="h-12 w-12 object-contain"
			/>
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
				<span class={accent.text}>{data.group}</span>
				<span class="text-[var(--hud-dim)]">·</span>
				<span class="text-[var(--hud-dim)]">
					{data.shell.canLoadSecondary ? 'Primary or secondary' : 'Primary slot only'}
				</span>
			</div>
			<h1
				class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase leading-tight tracking-[0.04em] text-[var(--hud-text)] md:text-3xl"
			>
				{data.shell.displayName}
			</h1>
		</div>
	</div>

	<section
		class="mt-3 rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
	>
		<div
			class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
		>
			Effect
		</div>
		<p class="text-sm leading-6 text-[var(--hud-muted)]">
			{data.shell.description.length > 0 ? data.shell.description : 'No description provided.'}
		</p>
	</section>

	<section
		class="mt-3 rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
	>
		<div
			class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
		>
			<span>Modifiers</span>
			<span class="font-mono text-[10px] text-[var(--hud-dim)]">
				{activeModifiers.length === 0 ? 'baseline' : `${activeModifiers.length} active`}
			</span>
		</div>
		<div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
			<p class="text-xs leading-5 text-[var(--hud-muted)] md:max-w-md">
				Shells multiply each tank's base stats. Pick a tank to see what this round actually delivers.
			</p>
			<div class="flex flex-col gap-1.5">
				<span class="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)]">
					Preview On
				</span>
				<button
					type="button"
					onclick={openTankModal}
					aria-haspopup="dialog"
					class="group flex min-w-[16rem] items-center gap-3 rounded-sm bg-[var(--hud-inset)] px-3 py-2.5 text-left ring-1 ring-[#454932]/35 transition hover:ring-[var(--hud-teal)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/60"
				>
					{#if selectedVehicle}
						<span
							class="flex h-9 w-12 shrink-0 items-center justify-center rounded-sm border border-[var(--hud-variant)]/80 bg-[var(--hud-inset)]/70 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.12)]"
						>
							<FallbackImage
								src="/images/vehicles/{selectedVehicle.id}.png"
								alt=""
								kind="vehicle"
								label={selectedVehicle.name}
								class="h-7 w-10 object-contain"
							/>
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)]">
								{selectedVehicle.name}
							</span>
							<span class="block text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
								{selectedVehicle.classLabel}
							</span>
						</span>
					{:else}
						<span
							class="flex h-9 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed border-[var(--hud-dim)]/50 text-[var(--hud-dim)]"
							aria-hidden="true"
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="h-4 w-4">
								<path d="M5 12h14M12 5v14" stroke-linecap="square" />
							</svg>
						</span>
						<span class="min-w-0 flex-1">
							<span class="block font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.06em] text-[var(--hud-muted)]">
								Pick A Tank
							</span>
							<span class="block text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
								Show real numbers
							</span>
						</span>
					{/if}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						class="h-4 w-4 shrink-0 text-[var(--hud-dim)] transition group-hover:text-[var(--hud-teal)]"
						aria-hidden="true"
					>
						<path d="M6 9l6 6 6-6" stroke-linecap="square" stroke-linejoin="miter" />
					</svg>
				</button>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
			{#each modifierEntries as [key, value]}
				{@const statKey = STAT_KEY[key]}
				{@const baseValue = statKey && selectedVehicle ? selectedVehicle.base[statKey] : null}
				{@const finalValue = baseValue !== null ? baseValue * value : null}
				{@const tone = modifierTone(key, value)}
				<div
					class="rounded-sm bg-[var(--hud-inset)] px-3 py-3 shadow-[inset_2px_0_0_0_rgba(160,170,217,0.18)]"
				>
					<div class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--hud-dim)]">
						{MODIFIER_LABELS[key] ?? key}
					</div>
					<div
						class="mt-2 font-[var(--font-display)] text-2xl font-bold leading-none tabular-nums {tone}"
					>
						{finalValue !== null ? formatStat(key, finalValue) : formatDelta(value)}
					</div>
					<div class="mt-2 font-mono text-[10px] tabular-nums leading-none">
						{#if finalValue !== null && value !== 1}
							{@const delta = finalValue - (baseValue ?? 0)}
							<span class={tone}
								>{delta > 0 ? '+' : ''}{formatStat(key, delta)}</span
							>
							<span class="text-[var(--hud-dim)]">
								from {formatStat(key, baseValue ?? 0)}</span
							>
						{:else if finalValue !== null}
							<span class="text-[var(--hud-dim)]">No change</span>
						{:else}
							<span class="text-[var(--hud-dim)]">×{value.toFixed(2)}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	{#if data.relatedShells.length > 0}
		<section
			class="mt-3 rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
		>
			<div
				class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Related</span>
				<span class="font-mono text-[10px] text-[var(--hud-dim)]">
					{data.group}
				</span>
			</div>
			<div class="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				{#each data.relatedShells as related}
					<a
						href={`/tools/shells/${related.slug}`}
						class="group flex items-center gap-2 rounded-sm bg-[var(--hud-inset)] px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)] transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.22)]"
					>
						<FallbackImage
							src="/images/ammo/{related.id}.png"
							alt=""
							kind="ammo"
							label={related.displayName}
							class="h-7 w-7 shrink-0 object-contain"
						/>
						<div
							class="min-w-0 flex-1 truncate font-[var(--font-display)] text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]"
						>
							{related.displayName}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</section>

{#if tankModalOpen}
	<div
		class="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6"
		role="presentation"
	>
		<button
			type="button"
			class="absolute inset-0 bg-[#0a0e17]/85 backdrop-blur-[3px]"
			aria-label="Close tank picker"
			onclick={closeTankModal}
		></button>

		<div
			class="relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-sm border border-[rgba(69,73,50,0.4)] bg-[var(--hud-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_0_0_1px_var(--hud-ghost)] sm:rounded-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="tank-modal-title"
		>
			<header
				class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--hud-variant)] bg-[var(--hud-panel-high)] px-4 py-4 shadow-[inset_0_2px_0_0_var(--hud-teal)] sm:px-6"
			>
				<div>
					<p class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-teal)]">
						Preview Vehicle
					</p>
					<h2
						id="tank-modal-title"
						class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
					>
						Pick a tank to preview {data.shell.displayName}
					</h2>
					<p class="mt-2 max-w-2xl text-sm text-[var(--hud-muted)]">
						The shell's modifiers will be applied to this tank's base stats so you can see real
						damage, penetration, and reload numbers.
					</p>
				</div>
				<button
					type="button"
					class="rounded-sm border-2 border-[var(--hud-teal)] bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/10"
					onclick={closeTankModal}
				>
					Close
				</button>
			</header>

			<div class="shrink-0 border-b border-[var(--hud-variant)] bg-[var(--hud-panel)] px-4 py-3 sm:px-6">
				<input
					type="text"
					bind:value={tankSearchQuery}
					placeholder="Search tanks…"
					class="w-full rounded-sm bg-[var(--hud-inset)] px-4 py-2.5 text-sm text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.35)] outline-none placeholder:text-[var(--hud-dim)] focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/35"
				/>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto bg-[var(--hud-surface)] px-4 py-4 sm:px-6 sm:py-5">
				<button
					type="button"
					class="mb-5 w-full rounded-sm border-2 border-dashed border-[var(--hud-dim)] py-3 text-sm font-semibold uppercase tracking-wide text-[var(--hud-muted)] transition hover:border-[var(--hud-teal)] hover:bg-[var(--hud-panel-mid)] hover:text-[var(--hud-text)]"
					onclick={() => pickTank('')}
				>
					Clear selection — show multipliers only
				</button>

				{#each groupedTanks as [classLabel, tanks]}
					<section class="mb-8 last:mb-0">
						<h3
							class="sticky top-0 z-[1] -mx-1 mb-3 border-b border-[var(--hud-variant)] bg-[var(--hud-surface)] px-1 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[var(--hud-teal)]"
						>
							{classLabel}
						</h3>
						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each tanks as tank}
								<button
									type="button"
									class={`flex items-center gap-3 rounded-sm p-3 text-left ring-1 transition ${
										selectedVehicleId === tank.id
											? 'bg-[var(--hud-teal)]/10 ring-[var(--hud-teal)] shadow-[inset_3px_0_0_0_var(--hud-teal)]'
											: 'bg-[var(--hud-panel-mid)] ring-[#454932]/25 hover:ring-[var(--hud-teal)]/35'
									}`}
									onclick={() => pickTank(tank.id)}
								>
									<span
										class="flex h-12 w-16 shrink-0 items-center justify-center rounded-sm border border-[var(--hud-variant)]/80 bg-[var(--hud-inset)]/70"
									>
										<FallbackImage
											src="/images/vehicles/{tank.id}.png"
											alt=""
											kind="vehicle"
											label={tank.name}
											class="h-9 w-14 object-contain"
										/>
									</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-[var(--font-display)] text-base font-semibold uppercase tracking-[0.04em] text-[var(--hud-text)]">
											{tank.name}
										</span>
										<span class="mt-0.5 block text-[10px] uppercase tracking-[0.2em] text-[var(--hud-dim)]">
											{tank.classLabel}
										</span>
										<span class="mt-1 block font-mono text-[10px] tabular-nums text-[var(--hud-muted)]">
											DMG {Math.round(tank.base.damage)} · PEN {Math.round(tank.base.penetration)} · RLD {tank.base.reload.toFixed(1)}s
										</span>
									</span>
								</button>
							{/each}
						</div>
					</section>
				{/each}

				{#if groupedTanks.length === 0}
					<p class="text-center text-sm text-[var(--hud-muted)]">
						No tanks match "{tankSearchQuery}".
					</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

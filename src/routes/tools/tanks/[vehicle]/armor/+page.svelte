<script lang="ts">
	import ArmorViewer from './ArmorViewer.svelte';
	import ArmorInfoPanel, { resultLabels } from './ArmorInfoPanel.svelte';
	import type { ArmorHitInfo } from './types';

	let { data } = $props();

	let hoveredArmor: ArmorHitInfo | null = $state(null);
	let pinnedArmor: ArmorHitInfo | null = $state(null);
	let selectedShooterId = $state('');
	let showArmorVisualizer = $state(true);
	let deployedMode = $state(false);
	let canHover = $state(true);

	const selectedShooter = $derived(
		data.shooters.find((entry) => entry.id === selectedShooterId) ?? data.tank
	);
	const effectiveArmorVisualizer = $derived(showArmorVisualizer);
	const displayedArmor = $derived.by((): ArmorHitInfo | null => pinnedArmor ?? hoveredArmor);

	function clearReadout() {
		hoveredArmor = null;
		pinnedArmor = null;
	}

	function formatPenetration(value: number) {
		return Number.isInteger(value) ? `${value}` : value.toFixed(1);
	}

	function effectiveThickness(info: ArmorHitInfo) {
		return Math.round(info.thickness / Math.cos((info.angle * Math.PI) / 180));
	}

	$effect(() => {
		const query = window.matchMedia('(hover: hover) and (pointer: fine)');
		const update = () => (canHover = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	$effect(() => {
		const availableShooters = data.shooters;
		const defaultShooterId = data.tank.id;
		if (!availableShooters.some((entry) => entry.id === selectedShooterId)) {
			selectedShooterId = defaultShooterId;
		}
	});

	$effect(() => {
		selectedShooterId;
		clearReadout();
	});

	$effect(() => {
		showArmorVisualizer;
		deployedMode;
		clearReadout();
	});
</script>

<svelte:head>
	<title>Tyr HQ | {data.tank.name} — Armor</title>
</svelte:head>

<section class="flex flex-col lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--hud-ghost)] bg-[var(--hud-surface)] px-4 py-3 md:px-6"
	>
		<a
			href="/tools/tanks/{data.tank.slug}"
			class="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
		>
			Back
		</a>
		<div class="h-4 w-px bg-[var(--hud-ghost)]"></div>
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<span
				class="truncate font-[var(--font-display)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--hud-text)]"
			>
				{data.tank.name}
			</span>
			<span class="hidden text-xs uppercase tracking-[0.22em] text-[var(--hud-teal)] sm:inline">
				Armor Inspection
			</span>
		</div>

		<div class="flex w-full flex-wrap items-center gap-2 md:w-auto md:gap-3">
			<label
				class="flex w-full min-w-0 items-center gap-3 rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2 md:w-auto md:min-w-[14rem]"
			>
				<span class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-dim)]">
					Shooter
				</span>
				<select
					bind:value={selectedShooterId}
					aria-label="Select shooter"
					class="w-full bg-transparent text-sm font-semibold uppercase tracking-[0.12em] text-[var(--hud-text)] outline-none"
				>
					{#each data.shooters as shooter}
						<option value={shooter.id}>{shooter.name}</option>
					{/each}
				</select>
			</label>

			<div
				class="flex items-center gap-2 rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2"
			>
				<div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-dim)]">
					Pen
				</div>
				<div class="font-[var(--font-mono)] text-sm text-[var(--hud-text)]">
					{formatPenetration(selectedShooter.stats.penetration)} mm
				</div>
			</div>

			<button
				type="button"
				aria-pressed={showArmorVisualizer}
				class={`rounded-sm border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
					showArmorVisualizer
						? 'border-[var(--hud-teal)] bg-[var(--hud-teal)]/12 text-[var(--hud-teal)]'
						: 'border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]'
				}`}
				onclick={() => (showArmorVisualizer = !showArmorVisualizer)}
			>
				{showArmorVisualizer ? 'Armor Viz On' : 'Armor Viz Off'}
			</button>

			{#if data.hasDeployedAnimations}
				<button
					type="button"
					aria-pressed={deployedMode}
					class={`rounded-sm border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
						deployedMode
							? 'border-[var(--hud-lime)] bg-[var(--hud-lime)]/12 text-[var(--hud-lime)]'
							: 'border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]'
					}`}
					onclick={() => (deployedMode = !deployedMode)}
				>
					{deployedMode ? 'Deployed' : 'Stowed'}
				</button>
			{/if}
		</div>
	</div>

	<div class="relative flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
		<div class="relative h-[55dvh] min-h-[20rem] lg:h-auto lg:min-h-0 lg:flex-1">
			<ArmorViewer
				vehicleId={data.tank.id}
				onhover={(info) => (hoveredArmor = info)}
				onclick={(info) => (pinnedArmor = info)}
				shellPenetration={selectedShooter.stats.penetration}
				showArmorVisualizer={effectiveArmorVisualizer}
				hasDeployedAnimations={data.hasDeployedAnimations}
				{deployedMode}
			/>

			{#if effectiveArmorVisualizer}
				<div class="pointer-events-none absolute inset-x-3 bottom-3 lg:hidden">
					{#if displayedArmor}
						{@const result = resultLabels[displayedArmor.result] ?? resultLabels.no_pen}
						<div
							class="flex items-center justify-between gap-3 rounded-sm border border-[var(--hud-ghost)] bg-[rgba(13,17,26,0.88)] px-3 py-2 backdrop-blur-sm"
						>
							<div class="min-w-0">
								<div class="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-dim)]">
									{pinnedArmor ? 'Pinned' : 'Readout'}
								</div>
								<div
									class="truncate font-[var(--font-display)] text-base font-bold uppercase {result.color}"
								>
									{result.label}
								</div>
								{#if displayedArmor.result !== 'module' && displayedArmor.result !== 'absorb'}
									<div class="font-[var(--font-mono)] text-xs text-[var(--hud-muted)]">
										{displayedArmor.thickness} mm &middot; {displayedArmor.angle.toFixed(1)}&deg;{displayedArmor.result !== 'ricochet'
											? ` · ${effectiveThickness(displayedArmor)} eff`
											: ''}
									</div>
								{/if}
							</div>
							{#if pinnedArmor}
								<button
									type="button"
									class="pointer-events-auto shrink-0 rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-muted)]"
									onclick={() => (pinnedArmor = null)}
								>
									Clear
								</button>
							{/if}
						</div>
					{:else}
						<div class="flex justify-center">
							<span
								class="rounded-sm border border-[var(--hud-ghost)] bg-[rgba(13,17,26,0.7)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-muted)] backdrop-blur-sm"
							>
								{canHover ? 'Click armor to pin a readout' : 'Tap armor to inspect'}
							</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<ArmorInfoPanel
			tank={data.tank}
			shooter={selectedShooter}
			hovered={hoveredArmor}
			pinned={pinnedArmor}
			visualizerEnabled={effectiveArmorVisualizer}
			{canHover}
			onClearPin={() => (pinnedArmor = null)}
		/>
	</div>
</section>

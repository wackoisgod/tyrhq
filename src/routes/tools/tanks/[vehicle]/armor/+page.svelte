<script lang="ts">
	import ArmorViewer from './ArmorViewer.svelte';
	import ArmorInfoPanel from './ArmorInfoPanel.svelte';
	import type { ArmorHitInfo } from './types';

	let { data } = $props();

	let hoveredArmor: ArmorHitInfo | null = $state(null);
	let pinnedArmor: ArmorHitInfo | null = $state(null);
	let selectedShooterId = $state('');
	let showArmorVisualizer = $state(true);
	let deployedMode = $state(false);

	const selectedShooter = $derived(
		data.shooters.find((entry) => entry.id === selectedShooterId) ?? data.tank
	);
	const effectiveArmorVisualizer = $derived(showArmorVisualizer);

	function clearReadout() {
		hoveredArmor = null;
		pinnedArmor = null;
	}

	function formatPenetration(value: number) {
		return Number.isInteger(value) ? `${value}` : value.toFixed(1);
	}

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

<section class="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
	<div class="flex items-center gap-4 border-b border-[var(--hud-ghost)] bg-[var(--hud-surface)] px-6 py-3">
		<a
			href="/tools/tanks/{data.tank.slug}"
			class="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
		>
			Back
		</a>
		<div class="h-4 w-px bg-[var(--hud-ghost)]"></div>
		<div class="flex items-center gap-3">
			<span
				class="font-[var(--font-display)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--hud-text)]"
			>
				{data.tank.name}
			</span>
			<span class="text-xs uppercase tracking-[0.22em] text-[var(--hud-teal)]">
				Armor Inspection
			</span>
		</div>

		<div class="ml-auto flex items-center gap-3">
			<label
				class="flex min-w-[14rem] items-center gap-3 rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2"
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

			<div class="rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2">
				<div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-dim)]">
					Penetration
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

	<div class="relative flex flex-1 overflow-hidden">
		<div class="flex-1">
			<ArmorViewer
				vehicleId={data.tank.id}
				onhover={(info) => (hoveredArmor = info)}
				onclick={(info) => (pinnedArmor = info)}
				shellPenetration={selectedShooter.stats.penetration}
				showArmorVisualizer={effectiveArmorVisualizer}
				hasDeployedAnimations={data.hasDeployedAnimations}
				{deployedMode}
			/>
		</div>

		<ArmorInfoPanel
			tank={data.tank}
			shooter={selectedShooter}
			hovered={hoveredArmor}
			pinned={pinnedArmor}
			visualizerEnabled={effectiveArmorVisualizer}
			onClearPin={() => (pinnedArmor = null)}
		/>
	</div>
</section>

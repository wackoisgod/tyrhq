<script lang="ts">
	import type { TankSummary } from '$lib/types/game';
	import type { ArmorHitInfo, ArmorHitResult } from './types';

	let {
		tank,
		shooter,
		hovered,
		pinned,
		visualizerEnabled,
		onClearPin
	}: {
		tank: TankSummary;
		shooter: TankSummary;
		hovered: ArmorHitInfo | null;
		pinned: ArmorHitInfo | null;
		visualizerEnabled: boolean;
		onClearPin: () => void;
	} = $props();

	let display = $derived(pinned ?? hovered);

	const resultLabels: Record<ArmorHitResult, { label: string; color: string }> = {
		penetrate: { label: 'PENETRATION', color: 'text-[#43ffbe]' },
		overmatch: { label: 'PENETRATION', color: 'text-[#43ffbe]' },
		ricochet: { label: 'NO PENETRATION', color: 'text-[var(--hud-text)]' },
		no_pen: { label: 'NO PENETRATION', color: 'text-[var(--hud-text)]' },
		fifty_fifty: { label: '50/50 ZONE', color: 'text-[#ffd400]' },
		module: { label: 'MODULE', color: 'text-[#3b5eff]' },
		absorb: { label: 'TRACK IMMOBILIZATION', color: 'text-[#ff1fb9]' }
	};
</script>

<aside class="flex w-80 shrink-0 flex-col border-l border-[var(--hud-ghost)] bg-[var(--hud-panel-deep)]">
	<div class="border-b border-[var(--hud-ghost)] p-5">
		<div class="text-xs uppercase tracking-[0.32em] text-[var(--hud-dim)]">Target</div>
		<div class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase text-[var(--hud-text)]">
			{tank.name}
		</div>
		<div class="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--hud-teal)]">
			{tank.classLabel} vehicle
		</div>
	</div>

	<div class="border-b border-[var(--hud-ghost)] p-5">
		<div class="hud-eyebrow">Armor Readout</div>
		<div class="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--hud-dim)]">
			<span>{shooter.name}</span>
			<span class="text-[var(--hud-teal)]">→</span>
			<span>{tank.name}</span>
		</div>

		{#if display}
			{@const result = resultLabels[display.result] ?? resultLabels.no_pen}
			<div class="mt-4 space-y-3">
				<div
					class="rounded-sm bg-[var(--hud-inset)] p-4 shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_var(--hud-ghost)]"
				>
					<div class="text-xs uppercase tracking-[0.22em] text-[var(--hud-dim)]">Result</div>
					<div class="mt-1 font-[var(--font-display)] text-lg font-bold uppercase {result.color}">
						{result.label}
					</div>
				</div>

				{#if display.result !== 'module' && display.result !== 'absorb'}
					<div class="grid grid-cols-2 gap-3">
						<div class="rounded-sm bg-[var(--hud-inset)] p-3 shadow-[inset_0_0_0_1px_var(--hud-ghost)]">
							<div class="text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)]">Thickness</div>
							<div class="mt-1 font-[var(--font-mono)] text-xl text-[var(--hud-text)]">
								{display.thickness}
							</div>
						</div>
						<div class="rounded-sm bg-[var(--hud-inset)] p-3 shadow-[inset_0_0_0_1px_var(--hud-ghost)]">
							<div class="text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)]">Impact Angle</div>
							<div class="mt-1 font-[var(--font-mono)] text-xl text-[var(--hud-text)]">
								{display.angle.toFixed(1)}&deg;
							</div>
						</div>
					</div>

					{#if display.result !== 'ricochet'}
						<div class="rounded-sm bg-[var(--hud-inset)] p-3 shadow-[inset_0_0_0_1px_var(--hud-ghost)]">
							<div class="text-[10px] uppercase tracking-[0.22em] text-[var(--hud-dim)]">
								Effective Thickness
							</div>
							<div class="mt-1 font-[var(--font-mono)] text-xl text-[var(--hud-text)]">
								{Math.round(display.thickness / Math.cos((display.angle * Math.PI) / 180))}
							</div>
						</div>
					{/if}
				{/if}

				{#if display.isFiftyFifty}
					<div
						class="rounded-sm border border-[#ffd400]/30 bg-[#ffd400]/8 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ffd400]"
					>
						Intermediate Zone
					</div>
				{/if}

				{#if pinned}
					<button
						class="w-full rounded-sm border border-[var(--hud-ghost)] bg-[var(--hud-panel-mid)] px-3 py-2 text-xs uppercase tracking-[0.18em] text-[var(--hud-muted)] transition hover:text-[var(--hud-text)]"
						onclick={onClearPin}
					>
						Clear Pin
					</button>
				{/if}
			</div>
		{:else if !visualizerEnabled}
			<p class="mt-4 text-sm leading-6 text-[var(--hud-muted)]">
				Armor visualizer disabled. Turn it back on to inspect armor sections and penetration values.
			</p>
		{:else}
			<p class="mt-4 text-sm leading-6 text-[var(--hud-muted)]">
				Hover over the model to inspect armor values. Click to pin a readout.
			</p>
		{/if}
	</div>

	<div class="p-5">
		<div class="hud-eyebrow">Vehicle Stats</div>
		<div class="mt-3 space-y-2">
			{#each [
				{ label: 'Shooter Pen', value: shooter.stats.penetration, unit: '' },
				{ label: 'Target Health', value: tank.stats.health, unit: '' },
				{ label: 'Target Damage', value: tank.stats.damage, unit: '' },
				{ label: 'Reload', value: shooter.stats.reloadTime, unit: 's' },
				{ label: 'Max Speed', value: tank.stats.maxSpeed, unit: 'kph' }
			] as stat}
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs uppercase tracking-[0.18em] text-[var(--hud-dim)]">{stat.label}</span>
					<span class="font-[var(--font-mono)] text-sm text-[var(--hud-text)]">
						{Number.isInteger(stat.value) ? stat.value : stat.value.toFixed(1)}{stat.unit ? ` ${stat.unit}` : ''}
					</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="mt-auto border-t border-[var(--hud-ghost)] p-5">
		<div class="hud-eyebrow">Color Legend</div>
		<div class="mt-3 space-y-2">
			{#each [
				{ color: 'bg-[#175950]', label: 'Penetration' },
				{ color: 'bg-[#594000]', label: '50/50 Zone' },
				{ color: 'bg-[#0a0b14]', label: 'No Penetration' },
				{ color: 'bg-[#1733bf]', label: 'Module' },
				{ color: 'bg-[#8f0f63]', label: 'Track Immobilization' }
			] as item}
				<div class="flex items-center gap-2">
					<div class="h-3 w-5 rounded-sm {item.color}"></div>
					<span class="text-xs text-[var(--hud-muted)]">{item.label}</span>
				</div>
			{/each}
		</div>
	</div>
</aside>

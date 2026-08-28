<script lang="ts">
	import { Canvas } from '@threlte/core';
	import ScaleScene from './ScaleScene.svelte';

	type ViewerTank = {
		id: string;
		name: string;
		classLabel: string;
		accent: string;
		modelAvailable: boolean;
	};
	type ModelDimensions = { length: number; width: number; height: number };

	let { tanks }: { tanks: ViewerTank[] } = $props();

	const modelTanks = $derived(tanks.filter((tank) => tank.modelAvailable));

	let dimensions = $state<Record<string, ModelDimensions>>({});
	let settledIds = $state<string[] | null>(null);

	const modelIdsKey = $derived(modelTanks.map((tank) => tank.id).join(','));

	// A new lineup means a new load batch: clear the "settled" marker so the
	// loading veil returns until the scene reports back.
	$effect(() => {
		modelIdsKey;
		settledIds = null;
	});

	const loading = $derived(modelTanks.length > 0 && settledIds === null);
	const failedTanks = $derived(
		settledIds === null ? [] : modelTanks.filter((tank) => !settledIds?.includes(tank.id))
	);

	function handleMeasure(vehicleId: string, dims: ModelDimensions) {
		dimensions = { ...dimensions, [vehicleId]: dims };
	}

	function handleSettled(loadedIds: string[]) {
		settledIds = loadedIds;
	}

	function formatMetres(value: number) {
		return `${value.toFixed(1)} m`;
	}
</script>

<div class="hud-panel-muted overflow-hidden rounded-sm">
	{#if modelTanks.length === 0}
		<div class="p-8 text-center text-sm text-[var(--hud-muted)]">
			Model assets are not published yet for the selected vehicles, so the scale view is offline.
		</div>
	{:else}
		<div class="relative h-[380px] bg-[var(--hud-surface)] md:h-[500px]">
			<div
				class="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:48px_48px]"
			></div>

			<Canvas>
				<ScaleScene
					tanks={modelTanks.map((tank) => ({ id: tank.id, accent: tank.accent }))}
					onmeasure={handleMeasure}
					onsettled={handleSettled}
				/>
			</Canvas>

			{#if loading}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--hud-surface)]/60"
				>
					<span class="hud-numeric text-xs uppercase tracking-[0.3em] text-[var(--hud-teal)]">
						Loading models…
					</span>
				</div>
			{/if}

			<div
				class="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-[var(--hud-surface)]/80 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--hud-dim)] backdrop-blur-sm"
			>
				Drag to orbit · Scroll to zoom · Grid cells are 1 m
			</div>
		</div>

		<div
			class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[rgba(69,73,50,0.3)] bg-[var(--hud-panel)] px-4 py-3"
		>
			{#each tanks as tank}
				{@const dims = dimensions[tank.id]}
				<div class="flex items-center gap-2.5">
					<span
						aria-hidden="true"
						class="h-2 w-2 shrink-0 rotate-45"
						style={`background: ${tank.accent};`}
					></span>
					<div>
						<div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--hud-text)]">
							{tank.name}
							<span class="ml-1 text-[9px] font-normal tracking-[0.2em] text-[var(--hud-dim)]">
								{tank.classLabel}
							</span>
						</div>
						<div class="font-mono text-[10px] tabular-nums text-[var(--hud-muted)]">
							{#if !tank.modelAvailable}
								Model assets pending
							{:else if failedTanks.some((entry) => entry.id === tank.id)}
								Model failed to load
							{:else if dims}
								L {formatMetres(dims.length)} · W {formatMetres(dims.width)} · H {formatMetres(dims.height)}
							{:else}
								Measuring…
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

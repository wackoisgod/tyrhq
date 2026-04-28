<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import type { BuildCardData } from '$lib/utils/build-card';

	let { build }: { build: BuildCardData } = $props();
</script>

<a href="/builds/{build.slug}" class="tyr-build-card group">
	<FallbackImage
		src="/images/vehicles/{build.vehicleId}.png"
		alt=""
		kind="vehicle"
		label={build.vehicleName}
		class="pointer-events-none absolute right-0 top-1/2 h-40 w-40 -translate-y-1/2 object-contain opacity-90 transition-all duration-300 group-hover:scale-105 group-hover:opacity-100 md:h-48 md:w-48"
		style="-webkit-mask-image: linear-gradient(to left, black 40%, transparent 96%); mask-image: linear-gradient(to left, black 40%, transparent 96%);"
	/>

	<div
		class="relative z-10 grid min-h-[11rem] content-start gap-4 p-4 pr-24 md:p-5 md:pr-36"
	>
		<div class="flex items-start justify-between gap-4">
			<div>
				<div class="hud-label">By {build.author}</div>
				<div
					class="tyr-build-card__title mt-3 text-[var(--hud-text)] transition-colors group-hover:text-[var(--hud-teal)]"
				>
					{build.title}
				</div>
			</div>

			<div class="shrink-0 text-right">
				<div class="hud-eyebrow text-[var(--hud-muted)]">{build.vehicleName}</div>
			</div>
		</div>

		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			<span>{build.vehicleName}</span>
			<span class="text-[var(--hud-variant)]">//</span>
			<span class="hud-numeric">{build.updatedLabel}</span>
			{#if build.starCount > 0}
				<span class="text-[var(--hud-variant)]">//</span>
				<span class="inline-flex items-center gap-1 text-[var(--hud-lime)]">
					<span class="text-[0.78rem] leading-none">&#9733;</span>
					<span class="hud-label leading-none text-[var(--hud-lime)]">
						{build.starCount}
					</span>
				</span>
			{/if}
		</div>

		{#if build.components.length > 0 || build.ammo.length > 0 || build.isAlphaProgram}
			<div class="flex flex-wrap items-end gap-2">
				<div class="flex flex-wrap items-center gap-1">
					{#each build.components as component, index (`${component.id}-${index}`)}
						<div
							class="flex h-9 w-9 items-center justify-center bg-[rgba(15,21,33,0.92)] shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
							title={component.name}
						>
							<FallbackImage
								src="/images/components/{component.id}.png"
								alt={component.name}
								kind="component"
								label={component.name}
								forceFallback={component.forceFallback}
								class="h-6 w-6 object-contain"
							/>
						</div>
					{/each}

					{#each build.ammo as ammo, index (`${ammo.id}-${index}`)}
						<div
							class="flex h-9 w-9 items-center justify-center bg-[rgba(153,247,255,0.08)] shadow-[inset_0_0_0_1px_rgba(153,247,255,0.16)]"
							title={ammo.name}
						>
							<FallbackImage
								src="/images/ammo/{ammo.id}.png"
								alt={ammo.name}
								kind="ammo"
								label={ammo.name}
								class="h-6 w-6 object-contain"
							/>
						</div>
					{/each}
				</div>

				{#if build.isAlphaProgram}
					<div
						class="alpha-program-chip alpha-program-chip--compact shrink-0"
						title="Alpha Program vehicle"
						aria-label="Alpha Program vehicle"
					>
						<span class="alpha-program-chip__label">Alpha</span>
						<span class="alpha-program-chip__mark">
							<span class="alpha-program-chip__icon" aria-hidden="true"></span>
						</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</a>

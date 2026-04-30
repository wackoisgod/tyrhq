<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import {
		fillComponentDescription,
		formatComponentCategory,
		plainComponentDescription
	} from '$lib/game-engine/component-format';

	let { data } = $props();

	const categoryLabel = $derived(formatComponentCategory(data.component.category));
	const descriptionText = $derived(
		fillComponentDescription(data.component.description, data.component.pointValues)
	);

	function getCategoryAccent(label: string) {
		switch (label) {
			case 'Firepower':
				return { text: 'text-[var(--hud-enemy)]', bar: 'bg-[var(--hud-enemy)]' };
			case 'Durability':
				return { text: 'text-[var(--hud-teal)]', bar: 'bg-[var(--hud-teal)]' };
			case 'Mobility':
				return { text: 'text-[var(--hud-lime)]', bar: 'bg-[var(--hud-lime)]' };
			case 'Scouting':
				return { text: 'text-[var(--hud-ally)]', bar: 'bg-[var(--hud-ally)]' };
			case 'Ability':
				return { text: 'text-[var(--hud-energy)]', bar: 'bg-[var(--hud-energy)]' };
			default:
				return { text: 'text-[var(--hud-muted)]', bar: 'bg-[var(--hud-purple-300)]' };
		}
	}

	const accent = $derived(getCategoryAccent(categoryLabel));

	function humanizeAttribute(raw: string) {
		if (!raw) return '';
		const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
		return spaced.replace(/\s+/g, ' ').trim();
	}

	function humanizeEventTag(raw: string) {
		const stripped = raw.replace(/^Gameplay\.Event\./, '');
		return humanizeAttribute(stripped.replace(/\./g, ' '));
	}

	const hasModifiers = $derived(
		data.linkedEffects.some((effect) => effect.modifiers.length > 0)
	);
</script>

<svelte:head>
	<title>Tyr HQ | {data.component.name}</title>
	<meta
		name="description"
		content={descriptionText.length > 0
			? descriptionText
			: `${data.component.name} — ${categoryLabel} component for Tyr.`}
	/>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<a
		href="/tools/components"
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
		Back To Components
	</a>

	<div
		class="mt-3 flex items-center gap-4 rounded-sm bg-[var(--hud-panel)] p-4 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12),0_18px_36px_rgba(0,0,0,0.22)]"
	>
		<div class="h-12 w-1 shrink-0 {accent.bar}"></div>
		<div
			class="flex h-16 w-16 shrink-0 items-center justify-center bg-[var(--hud-inset)] shadow-[inset_0_0_0_1px_rgba(160,170,217,0.10)]"
		>
			<FallbackImage
				src="/images/components/{data.component.id}.png"
				alt={data.component.name}
				kind="component"
				label={data.component.name}
				class="h-12 w-12 object-contain"
			/>
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
				<span class={accent.text}>{categoryLabel}</span>
				<span class="text-[var(--hud-dim)]">·</span>
				<span class="text-[var(--hud-dim)]">
					{data.component.eventTags.length === 0
						? 'Always active'
						: `${data.component.eventTags.length} trigger${data.component.eventTags.length === 1 ? '' : 's'}`}
				</span>
				{#if data.component.isConditional}
					<span
						class="rounded-sm bg-[var(--hud-lime)]/15 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.16em] text-[var(--hud-lime)] shadow-[inset_0_0_0_1px_rgba(213,255,1,0.32)]"
					>
						Conditional
					</span>
				{/if}
			</div>
			<h1
				class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase leading-tight tracking-[0.04em] text-[var(--hud-text)] md:text-3xl"
			>
				{data.component.name}
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
			{descriptionText.length > 0 ? descriptionText : 'No description provided.'}
		</p>
	</section>

	<div class="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
		<section
			class="rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
		>
			<div
				class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Triggers</span>
				<span class="font-mono text-[10px] text-[var(--hud-dim)]">
					{data.component.eventTags.length === 0 ? '—' : data.component.eventTags.length}
				</span>
			</div>
			{#if data.component.eventTags.length === 0}
				<p class="text-sm leading-6 text-[var(--hud-muted)]">
					Always active — no event required.
				</p>
			{:else}
				<ul class="flex flex-col gap-1.5">
					{#each data.component.eventTags as tag}
						<li
							class="rounded-sm bg-[var(--hud-inset)] px-2.5 py-1.5 shadow-[inset_2px_0_0_0_var(--hud-lime)]"
						>
							<span
								class="font-[var(--font-display)] text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)]"
								title={tag}
							>
								{humanizeEventTag(tag)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section
			class="rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
		>
			<div
				class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Linked Effects</span>
				<span class="font-mono text-[10px] text-[var(--hud-dim)]">
					{data.linkedEffects.length}
				</span>
			</div>
			{#if data.linkedEffects.length === 0}
				<p class="text-sm leading-6 text-[var(--hud-muted)]">No gameplay effects on record.</p>
			{:else if !hasModifiers}
				<p class="text-sm leading-6 text-[var(--hud-muted)]">
					{data.linkedEffects.length} effect{data.linkedEffects.length === 1 ? '' : 's'} applied via custom calculation. See description and point values for the magnitude.
				</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each data.linkedEffects as effect}
						{#if effect.modifiers.length > 0}
							<div
								class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-sm bg-[var(--hud-inset)] px-2.5 py-2 font-mono text-[11px] shadow-[inset_2px_0_0_0_var(--hud-teal)]"
							>
								{#each effect.modifiers as modifier}
									<span class="truncate text-[var(--hud-text)]" title={modifier.attribute}>
										{humanizeAttribute(modifier.attribute)}
									</span>
									<span class="text-right text-[var(--hud-muted)]">{modifier.op}</span>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	</div>

	<section
		class="mt-3 rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
	>
		<div
			class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
		>
			<span>Native Vehicles</span>
			<span class="font-mono text-[10px] text-[var(--hud-dim)]">
				{data.nativeVehicles.length === 0 ? '—' : data.nativeVehicles.length}
			</span>
		</div>
		{#if data.nativeVehicles.length === 0}
			<p class="text-sm leading-6 text-[var(--hud-muted)]">
				No vehicle unlocks {data.component.name} natively — equip it manually in the build planner.
			</p>
		{:else}
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.nativeVehicles as vehicle}
					<a
						href={`/tools/tanks/${vehicle.slug}`}
						class="group flex items-center gap-2.5 rounded-sm bg-[var(--hud-inset)] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)] transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.22)]"
					>
						<FallbackImage
							src="/images/vehicles/{vehicle.id}.png"
							alt={vehicle.name}
							kind="vehicle"
							label={vehicle.name}
							class="h-8 w-12 shrink-0 object-contain"
						/>
						<div class="min-w-0 flex-1">
							<div
								class="truncate font-[var(--font-display)] text-[12px] font-semibold uppercase leading-tight tracking-[0.06em] text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]"
							>
								{vehicle.name}
							</div>
							<div class="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
								{vehicle.classLabel}
							</div>
						</div>
						<span
							class="shrink-0 rounded-sm bg-[var(--hud-lime)]/12 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--hud-lime)]"
						>
							Lvl {vehicle.level}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>


	{#if data.relatedComponents.length > 0}
		<section
			class="mt-3 rounded-sm bg-[var(--hud-panel)] p-5 shadow-[inset_0_0_0_1px_rgba(160,170,217,0.12)]"
		>
			<div
				class="mb-2 flex items-baseline justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Related</span>
				<span class="font-mono text-[10px] text-[var(--hud-dim)]">
					{categoryLabel}
				</span>
			</div>
			<div class="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				{#each data.relatedComponents as related}
					<a
						href={`/tools/components/${related.slug}`}
						class="group flex items-center gap-2 rounded-sm bg-[var(--hud-inset)] px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)] transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(69,73,50,0.22)]"
					>
						<FallbackImage
							src="/images/components/{related.id}.png"
							alt=""
							kind="component"
							label={related.name}
							class="h-7 w-7 shrink-0 object-contain"
						/>
						<div
							class="min-w-0 flex-1 truncate font-[var(--font-display)] text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]"
						>
							{related.name}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

</section>

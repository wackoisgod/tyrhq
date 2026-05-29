<script lang="ts">
	let {
		value,
		max = 5,
		size = 'md',
		showValue = false,
		class: className = ''
	}: {
		value: number | undefined;
		max?: number;
		size?: 'sm' | 'md' | 'lg';
		showValue?: boolean;
		class?: string;
	} = $props();

	// Cohesive on-brand ramp: the standard teal accent at the low end climbing to
	// the lime "critical / energy" accent at the high end. Both are signature HUD
	// colours, so the gauge escalates without introducing off-palette warm tones.
	const RAMP = ['#99f7ff', '#a8f9bf', '#b7fb80', '#c6fd40', '#d5ff01'];

	const rating = $derived(Math.max(0, Math.min(max, Math.round(value ?? 0))));
	const slots = $derived(Array.from({ length: max }, (_, index) => index));

	// Each filled segment is tinted by its own position on the ramp so the bar
	// reads as a teal→lime climb. Works for any `max`, not just 5.
	function segColor(index: number) {
		const t = max <= 1 ? 0 : index / (max - 1);
		return RAMP[Math.round(t * (RAMP.length - 1))];
	}
</script>

<div class={`dm dm--${size} ${className}`} role="img" aria-label={`Difficulty ${rating} of ${max}`}>
	<div class="dm__bars">
		{#each slots as index}
			{@const filled = index < rating}
			<span
				class="dm__bar"
				class:dm__bar--on={filled}
				style={`height:${Math.round(36 + (index * 64) / Math.max(1, max - 1))}%;${filled ? `--c:${segColor(index)};` : ''}`}
			></span>
		{/each}
	</div>

	{#if showValue}
		<span class="dm__value">{rating}<span class="dm__max">/{max}</span></span>
	{/if}
</div>

<style>
	.dm {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dm__bars {
		display: inline-flex;
		align-items: flex-end;
		gap: var(--dm-gap);
		height: var(--dm-h);
	}

	.dm__bar {
		width: var(--dm-bar-w);
		min-height: 18%;
		border-radius: 0;
		background: rgba(160, 170, 217, 0.16);
		box-shadow: inset 0 0 0 1px rgba(160, 170, 217, 0.12);
		transition:
			background-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.dm__bar--on {
		background: var(--c, var(--hud-teal));
		box-shadow:
			0 0 7px color-mix(in srgb, var(--c, var(--hud-teal)) 50%, transparent),
			inset 0 1px 0 0 rgba(255, 255, 255, 0.26);
	}

	.dm__value {
		font-family: var(--font-mono);
		font-size: var(--dm-value-size);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--hud-text);
	}

	.dm__max {
		color: var(--hud-dim);
	}

	/* Sizes */
	.dm--sm {
		--dm-h: 0.95rem;
		--dm-bar-w: 0.26rem;
		--dm-gap: 0.13rem;
		--dm-value-size: 0.62rem;
		gap: 0.4rem;
	}

	.dm--md {
		--dm-h: 1.5rem;
		--dm-bar-w: 0.36rem;
		--dm-gap: 0.18rem;
		--dm-value-size: 0.92rem;
	}

	.dm--lg {
		--dm-h: 2rem;
		--dm-bar-w: 0.5rem;
		--dm-gap: 0.24rem;
		--dm-value-size: 1.1rem;
	}
</style>

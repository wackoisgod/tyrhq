<script lang="ts">
	type ImageKind = 'vehicle' | 'component' | 'ammo' | 'talent' | 'generic';

	let {
		src,
		alt = '',
		title = '',
		class: className = '',
		kind = 'generic',
		label = '',
		style = '',
		forceFallback = false,
		...rest
	}: {
		src: string;
		alt?: string;
		title?: string;
		class?: string;
		kind?: ImageKind;
		label?: string;
		style?: string;
		forceFallback?: boolean;
	} = $props();

	let failed = $state(false);
	let imageElement = $state<HTMLImageElement | null>(null);

	const fallbackText = $derived.by(() => {
		const source = (label || alt || title || kind).trim();
		const words = source.match(/[A-Za-z0-9]+/g) ?? [];
		if (!words.length) {
			return kind === 'vehicle'
				? 'V'
				: kind === 'component'
					? 'C'
					: kind === 'ammo'
						? 'A'
						: kind === 'talent'
							? 'T'
							: '?';
		}
		return words
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	});

	const toneClass = $derived(
		kind === 'vehicle'
			? 'ui-fallback-icon--vehicle'
			: kind === 'component'
				? 'ui-fallback-icon--component'
				: kind === 'ammo'
					? 'ui-fallback-icon--ammo'
					: kind === 'talent'
						? 'ui-fallback-icon--talent'
						: 'ui-fallback-icon--generic'
	);

	const effectiveTitle = $derived((title || label || alt).trim());

	$effect(() => {
		if (forceFallback) {
			failed = true;
			return;
		}

		src;
		failed = false;
	});

	$effect(() => {
		if (failed || !imageElement) return;

		const currentImage = imageElement;

		queueMicrotask(() => {
			if (currentImage !== imageElement || failed) return;
			if (currentImage.complete && currentImage.naturalWidth === 0) {
				failed = true;
			}
		});
	});
</script>

{#if failed || forceFallback}
	<span
		class={`ui-fallback-icon ${toneClass} ${className}`}
		title={effectiveTitle}
		aria-label={effectiveTitle || `${kind} icon unavailable`}
		{...rest}
	>
		<span class="ui-fallback-icon__glyph">{fallbackText}</span>
	</span>
{:else}
	{#key src}
		<img
			bind:this={imageElement}
			src={src}
			alt={alt}
			title={effectiveTitle}
			class={className}
			style={style}
			{...rest}
			onload={() => {
				failed = false;
			}}
			onerror={() => {
				failed = true;
			}}
		/>
	{/key}
{/if}

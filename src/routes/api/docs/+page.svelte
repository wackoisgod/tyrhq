<script lang="ts">
	import { onMount } from 'svelte';

	import swaggerCssUrl from 'swagger-ui-dist/swagger-ui.css?url';

	let { data } = $props();

	let container = $state<HTMLDivElement | undefined>(undefined);
	let loadError = $state<string | null>(null);

	onMount(() => {
		let disposed = false;
		let swaggerUi: { destroy?: () => void } | undefined;

		const loadSwagger = async () => {
			try {
				const module = await import('swagger-ui-dist/swagger-ui-bundle.js');
				const SwaggerUiBundle = (module.default ?? module) as (options: Record<string, unknown>) => {
					destroy?: () => void;
				};

				if (disposed || !container) return;

				swaggerUi = SwaggerUiBundle({
					domNode: container,
					url: '/api/openapi.json',
					deepLinking: true,
					displayRequestDuration: true,
					docExpansion: 'list',
					defaultModelsExpandDepth: 1,
					persistAuthorization: true,
					supportedSubmitMethods: ['get']
				});
			} catch (caught) {
				console.error('[api-docs] Failed to initialize Swagger UI', caught);
				loadError = 'Swagger UI failed to load.';
			}
		};

		loadSwagger();

		return () => {
			disposed = true;
			swaggerUi?.destroy?.();
		};
	});
</script>

<svelte:head>
	<title>Tyr HQ | API Docs</title>
	<link rel="stylesheet" href={swaggerCssUrl} />
</svelte:head>

<section class="mx-auto max-w-7xl px-6 py-12">
	<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="hud-eyebrow tracking-[0.28em]">Developer Access</p>
			<h1 class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]">
				Public API Docs
			</h1>
			<p class="mt-3 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
				The contract is public. Live API calls require a Tyr HQ account and a single API key
				generated from the Developer API settings page.
			</p>
		</div>

		<div class="flex flex-wrap gap-3">
			<a href="/api/openapi.json" class="hud-cta-outline px-4 py-2 text-sm">Download OpenAPI</a>
			{#if data.user}
				<a href="/settings/api" class="hud-cta px-4 py-2 text-sm">Manage API Key</a>
			{:else}
				<a href="/auth" class="hud-cta px-4 py-2 text-sm">Sign In For API Key</a>
			{/if}
		</div>
	</div>

	<div class="hud-panel p-4">
		{#if loadError}
			<div
				class="border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
			>
				{loadError}
			</div>
		{:else}
			<div bind:this={container} class="swagger-shell"></div>
		{/if}
	</div>
</section>

<style>
	:global(.swagger-shell) {
		background: #f6f8fb;
		border-radius: 2px;
		padding: 1rem;
	}

	:global(.swagger-ui .topbar) {
		display: none;
	}

	:global(.swagger-ui .info .title),
	:global(.swagger-ui .opblock-tag) {
		font-family: var(--font-display);
	}

	:global(.swagger-ui .btn.authorize) {
		border-color: rgba(102, 218, 190, 0.4);
		color: #0a0e17;
		background: #caf200;
	}

	:global(.swagger-ui .opblock.opblock-get) {
		border-color: rgba(102, 218, 190, 0.25);
	}

	:global(.swagger-ui .opblock.opblock-get .opblock-summary) {
		border-color: rgba(102, 218, 190, 0.25);
	}
</style>

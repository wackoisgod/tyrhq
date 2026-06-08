<script lang="ts">
	import { page } from '$app/state';

	const status = $derived(page.status);
	const err = $derived(page.error);
	// Withdrawn notice: a 410 thrown by the public [slug] routes carries
	// `withdrawn` plus the resource title and a back link (see app.d.ts).
	const isWithdrawn = $derived(status === 410 && Boolean(err?.withdrawn));

	const backHref = $derived(err?.backHref ?? '/');
	const backLabel = $derived(err?.backLabel ?? 'Back to Home');

	const heading = $derived(
		isWithdrawn
			? (err?.message ?? 'This content has been withdrawn')
			: status === 404
				? 'Page not found'
				: 'Something went wrong'
	);
</script>

<svelte:head>
	<title>Tyr HQ | {isWithdrawn ? 'Withdrawn' : `Error ${status}`}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-16 md:px-6">
	<div class="hud-panel w-full p-8 text-center md:p-12">
		<p class="hud-label">Status {status}</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase tracking-[0.06em] text-[var(--hud-text)] md:text-4xl"
		>
			{heading}
		</h1>

		<p class="mx-auto mt-4 max-w-md text-base leading-7 text-[var(--hud-muted)]">
			{#if isWithdrawn}
				{#if err?.title}
					“{err.title}” is no longer available. It may return after revision.
				{:else}
					This content is no longer available. It may return after revision.
				{/if}
			{:else}
				{err?.message ?? 'An unexpected error occurred.'}
			{/if}
		</p>

		<a href={backHref} class="hud-cta-outline mt-8 px-6 py-3">
			{backLabel}
		</a>
	</div>
</section>

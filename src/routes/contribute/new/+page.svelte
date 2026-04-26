<script lang="ts">
	import SubmissionForm from '$lib/contribute/SubmissionForm.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Tyr HQ | Write a new article</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<a
		href="/contribute/mine"
		class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)]"
	>
		← My contributions
	</a>
	<h1
		class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Write a new article
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Use the toolbar above the editor for formatting and to insert YouTube embeds or callout
		boxes. Toggle "Show preview" to see exactly how your article will render.
	</p>

	<div class="mt-8">
		<SubmissionForm defaultType={data.type} />
	</div>
</section>

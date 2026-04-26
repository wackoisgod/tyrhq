<script lang="ts">
	import SubmissionForm from '$lib/contribute/SubmissionForm.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Tyr HQ | Edit submission</title>
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
		Edit submission
	</h1>

	<div class="mt-8">
		<SubmissionForm submission={data.submission} />
	</div>
</section>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { registerArticleCustomElements } from './custom-elements';
	import { enhanceArticleHeadings } from './heading-anchors';

	let { html }: { html: string } = $props();

	let container: HTMLDivElement;

	onMount(() => {
		registerArticleCustomElements();
	});

	// Backfill heading ids + permalink anchors whenever the body HTML changes
	// (covers the live editor preview, not just static article pages).
	$effect(() => {
		// reference `html` so the effect re-runs when the body is replaced
		void html;
		tick().then(() => enhanceArticleHeadings(container));
	});
</script>

<div class="prose-hud" bind:this={container}>
	<!-- Body HTML is server-side sanitised through src/lib/server/content-sanitize.ts;
	     never render raw user input here without that pipeline. -->
	{@html html}
</div>

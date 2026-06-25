<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { registerArticleCustomElements } from './custom-elements';
	import { enhanceArticleHeadings } from './heading-anchors';

	let { html }: { html: string } = $props();

	let container: HTMLDivElement;
	let didInitialScroll = false;

	/**
	 * Scroll to the heading named in the URL hash. The browser's own initial
	 * jump on a deep link often misses: for legacy content the target id is only
	 * assigned client-side (after hydration), and late-loading images/embeds
	 * shift offsets after the fact. Re-running it once ids exist — and again once
	 * media settles — makes permalinks land reliably, mobile included.
	 */
	function scrollToHash(behavior: ScrollBehavior = 'instant') {
		if (typeof window === 'undefined') return;
		const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
		if (!id) return;
		const target = document.getElementById(id);
		if (target) target.scrollIntoView({ behavior, block: 'start' });
	}

	onMount(() => {
		registerArticleCustomElements();
		// Images/iframes finishing load can move the target; realign once.
		const onLoad = () => scrollToHash();
		window.addEventListener('load', onLoad);
		return () => window.removeEventListener('load', onLoad);
	});

	// Backfill heading ids + permalink anchors whenever the body HTML changes
	// (covers the live editor preview, not just static article pages).
	$effect(() => {
		// reference `html` so the effect re-runs when the body is replaced
		void html;
		tick().then(() => {
			enhanceArticleHeadings(container);
			// Only on first render — don't yank the page while editing in preview.
			if (!didInitialScroll) {
				didInitialScroll = true;
				scrollToHash();
			}
		});
	});
</script>

<div class="prose-hud" bind:this={container}>
	<!-- Body HTML is server-side sanitised through src/lib/server/content-sanitize.ts;
	     never render raw user input here without that pipeline. -->
	{@html html}
</div>

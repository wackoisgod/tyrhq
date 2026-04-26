<script lang="ts">
	import { onMount } from 'svelte';
	import { registerArticleCustomElements } from './custom-elements';

	let { html }: { html: string } = $props();

	onMount(() => {
		registerArticleCustomElements();
	});
</script>

<div class="prose-hud">
	<!-- Body HTML is server-side sanitised through src/lib/server/content-sanitize.ts;
	     never render raw user input here without that pipeline. -->
	{@html html}
</div>

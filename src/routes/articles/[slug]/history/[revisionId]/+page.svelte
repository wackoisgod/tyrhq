<script lang="ts">
	import RevisionDiffPage from '$lib/contribute/RevisionDiffPage.svelte';

	let { data } = $props();
</script>

<RevisionDiffPage
	title={data.article.title}
	historyHref={`/articles/${data.article.slug}/history`}
	diff={data.diff}
/>

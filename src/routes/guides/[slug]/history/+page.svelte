<script lang="ts">
	import RevisionHistoryPage from '$lib/contribute/RevisionHistoryPage.svelte';

	let { data } = $props();
</script>

<RevisionHistoryPage
	title={data.article.title}
	basePath={`/guides/${data.article.slug}/history`}
	articleHref={`/guides/${data.article.slug}`}
	currentRevisionId={data.article.currentRevisionId}
	revisions={data.revisions}
	contributors={data.contributors}
/>

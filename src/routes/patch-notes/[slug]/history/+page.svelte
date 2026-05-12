<script lang="ts">
	import RevisionHistoryPage from '$lib/contribute/RevisionHistoryPage.svelte';

	let { data } = $props();
</script>

<RevisionHistoryPage
	title={data.article.title}
	basePath={`/patch-notes/${data.article.slug}/history`}
	articleHref={`/patch-notes/${data.article.slug}`}
	currentRevisionId={data.article.currentRevisionId}
	revisions={data.revisions}
	contributors={data.contributors}
/>

<script lang="ts">
	import ArticlePageShell from '$lib/contribute/ArticlePageShell.svelte';
	import ArticleActionsBar from '$lib/contribute/ArticleActionsBar.svelte';

	let { data } = $props();
</script>

<ArticlePageShell
	type="article"
	article={data.post}
	contributors={data.contributors}
	historyHref={`/articles/${data.post.slug}/history`}
	backHref="/articles"
	backLabel="Back To Articles"
>
	{#snippet footer()}
		<ArticleActionsBar
			articleId={data.post.id}
			articleType="article"
			signedIn={Boolean(data.user)}
			canModerate={data.role === 'contributor' || data.role === 'admin'}
		/>
	{/snippet}
</ArticlePageShell>

<script lang="ts">
	let {
		id,
		title = 'YouTube video'
	}: { id: string; title?: string } = $props();
</script>

<div
	class="my-6 aspect-video overflow-hidden rounded-sm border border-[rgba(69,73,50,0.4)] bg-black shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
>
	<iframe
		src="https://www.youtube-nocookie.com/embed/{id}"
		{title}
		frameborder="0"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
		allowfullscreen
		loading="lazy"
		class="h-full w-full"
	></iframe>
</div>

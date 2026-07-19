<script lang="ts">
	import { onMount } from 'svelte';
	import type { TocHeading } from './toc';

	let {
		headings = [],
		sidebar = false
	}: { headings?: TocHeading[]; sidebar?: boolean } = $props();

	let activeId = $state('');

	// Indent deeper headings relative to the shallowest level actually present,
	// so a guide that starts at h3 still left-aligns cleanly.
	const minLevel = $derived(
		headings.length ? Math.min(...headings.map((h) => h.level)) : 2
	);

	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') return;

		const ids = headings.map((h) => h.id);
		const elements = ids
			.map((id) => document.getElementById(id))
			.filter((el): el is HTMLElement => Boolean(el));
		if (elements.length === 0) return;

		const visible = new Set<string>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) visible.add(entry.target.id);
					else visible.delete(entry.target.id);
				}
				// Highlight the first heading (in document order) currently on screen.
				const firstVisible = ids.find((id) => visible.has(id));
				if (firstVisible) activeId = firstVisible;
			},
			// Bias the active band toward the top of the viewport.
			{ rootMargin: '-10% 0px -70% 0px', threshold: 0 }
		);

		for (const el of elements) observer.observe(el);
		return () => observer.disconnect();
	});

	function handleClick(event: MouseEvent, id: string) {
		const target = document.getElementById(id);
		if (!target) return;
		event.preventDefault();
		history.replaceState(null, '', `#${id}`);
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		activeId = id;
	}
</script>

{#if headings.length > 1}
	<nav class="toc" class:toc--rail={sidebar} aria-label="Table of contents">
		<details class="toc__details" open>
			<summary class="toc__summary">Contents</summary>
			<ul class="toc__list">
				{#each headings as heading (heading.id)}
					<li
						class="toc__item"
						style="--toc-depth: {Math.max(0, heading.level - minLevel)}"
					>
						<a
							class="toc__link"
							class:toc__link--active={activeId === heading.id}
							href="#{heading.id}"
							aria-current={activeId === heading.id ? 'location' : undefined}
							onclick={(e) => handleClick(e, heading.id)}
						>
							{heading.text}
						</a>
					</li>
				{/each}
			</ul>
		</details>
	</nav>
{/if}

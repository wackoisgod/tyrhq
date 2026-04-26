<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'info' | 'warning' | 'tip';
	let {
		type = 'info',
		title,
		children
	}: { type?: Variant; title?: string; children: Snippet } = $props();

	const styles: Record<Variant, string> = {
		info: 'border-l-[var(--hud-teal)] bg-[var(--hud-teal)]/10',
		warning: 'border-l-[var(--hud-lime)] bg-[var(--hud-lime)]/10',
		tip: 'border-l-[var(--hud-muted)] bg-[var(--hud-panel-mid)]'
	};

	const labels: Record<Variant, string> = {
		info: 'Info',
		warning: 'Warning',
		tip: 'Tip'
	};
</script>

<aside class="my-6 rounded-sm border-l-2 p-4 {styles[type]}">
	<div
		class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
	>
		{title ?? labels[type]}
	</div>
	<div class="mt-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
		{@render children()}
	</div>
</aside>

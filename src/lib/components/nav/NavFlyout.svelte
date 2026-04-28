<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { NavGroup } from '$lib/content/site';

	let {
		item,
		isActive
	}: {
		item: NavGroup;
		isActive: (href: string) => boolean;
	} = $props();

	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let wrapperEl: HTMLDivElement | undefined = $state();
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const panelId = `nav-flyout-${item.label.toLowerCase().replace(/\s+/g, '-')}-panel`;

	const childActive = $derived(item.columns.some((c) => c.items.some((i) => isActive(i.href))));

	function clearTimers() {
		if (openTimer) clearTimeout(openTimer);
		if (closeTimer) clearTimeout(closeTimer);
		openTimer = undefined;
		closeTimer = undefined;
	}

	function scheduleOpen() {
		clearTimers();
		openTimer = setTimeout(() => {
			open = true;
		}, 80);
	}

	function scheduleClose() {
		clearTimers();
		closeTimer = setTimeout(() => {
			open = false;
		}, 150);
	}

	function toggle() {
		clearTimers();
		open = !open;
	}

	function close() {
		clearTimers();
		open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			close();
			triggerEl?.focus();
		}
	}

	function handleDocumentPointerDown(event: PointerEvent) {
		if (!open) return;
		const target = event.target;
		if (target instanceof Node && wrapperEl?.contains(target)) return;
		close();
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('pointerdown', handleDocumentPointerDown);
		return () => document.removeEventListener('pointerdown', handleDocumentPointerDown);
	});

	onDestroy(clearTimers);
</script>

<div
	class="tyr-nav-flyout"
	bind:this={wrapperEl}
	onpointerenter={scheduleOpen}
	onpointerleave={scheduleClose}
	onkeydown={handleKeydown}
	role="presentation"
>
	<button
		type="button"
		class="tyr-nav-link tyr-nav-flyout__trigger"
		bind:this={triggerEl}
		onclick={toggle}
		aria-haspopup="true"
		aria-expanded={open}
		aria-controls={panelId}
		aria-current={childActive ? 'page' : undefined}
	>
		{item.label}
		<svg
			class="tyr-nav-flyout__chevron"
			viewBox="0 0 12 12"
			width="12"
			height="12"
			aria-hidden="true"
		>
			<path
				d="M2 4.5l4 4 4-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="square"
				stroke-linejoin="miter"
			/>
		</svg>
	</button>

	<div
		id={panelId}
		class="tyr-nav-flyout__panel"
		data-open={open ? 'true' : undefined}
		role="menu"
		aria-label={item.label}
	>
		<div class="tyr-nav-flyout__cols">
			{#each item.columns as col}
				<div class="tyr-nav-flyout__col">
					<p class="hud-eyebrow tyr-nav-flyout__heading">{col.heading}</p>
					<ul class="tyr-nav-flyout__list">
						{#each col.items as leaf}
							<li>
								<a
									href={leaf.href}
									class="tyr-nav-flyout__item"
									role="menuitem"
									aria-current={isActive(leaf.href) ? 'page' : undefined}
									onclick={close}
								>
									{leaf.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
</div>

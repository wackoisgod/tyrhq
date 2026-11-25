<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { formatNotificationWhen, type NotificationItem } from '$lib/notifications';

	let {
		unreadCount,
		notifications
	}: {
		unreadCount: number;
		notifications: NotificationItem[];
	} = $props();

	let open = $state(false);
	let pending = $state(false);
	let wrapperEl: HTMLDivElement | undefined = $state();
	let triggerEl: HTMLButtonElement | undefined = $state();

	const label = $derived(
		unreadCount > 0
			? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
			: 'Notifications'
	);

	function close() {
		open = false;
	}

	function toggle() {
		open = !open;
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

	async function mark(body: { id: string } | { all: true }) {
		pending = true;
		try {
			await fetch('/api/notifications', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			await invalidate('supabase:auth');
		} finally {
			pending = false;
		}
	}

	async function openItem(event: MouseEvent, item: NotificationItem) {
		event.preventDefault();
		if (!item.readAt) await mark({ id: item.id });
		window.location.href = item.link ?? '/notifications';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="tyr-bell-wrap" bind:this={wrapperEl}>
	<button
		type="button"
		class="tyr-bell"
		bind:this={triggerEl}
		aria-label={label}
		aria-expanded={open}
		aria-controls="notification-panel"
		onclick={toggle}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
			<path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13.5 6 9.5z" />
			<path d="M10 18.5a2 2 0 0 0 4 0" />
		</svg>
		{#if unreadCount > 0}
			<span class="tyr-bell__count">{unreadCount > 9 ? '9+' : unreadCount}</span>
		{/if}
	</button>

	{#if open}
		<div id="notification-panel" class="tyr-notification-panel">
			<div class="tyr-notification-panel__head">
				<p>Notifications</p>
				{#if unreadCount > 0}
					<button type="button" class="tyr-notification-panel__action" disabled={pending} onclick={() => mark({ all: true })}>
						Mark all read
					</button>
				{/if}
			</div>

			{#if notifications.length === 0}
				<p class="tyr-notification-panel__empty">No notifications yet.</p>
			{:else}
				<ul>
					{#each notifications as item (item.id)}
						<li>
							<a
								href={item.link ?? '/notifications'}
								class="tyr-notification-item"
								class:is-unread={!item.readAt}
								onclick={(event) => openItem(event, item)}
							>
								<span class="tyr-notification-item__title">{item.title}</span>
								<span class="tyr-notification-item__body">{item.body}</span>
								<span class="tyr-notification-item__when">{formatNotificationWhen(item.createdAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}

			<a class="tyr-notification-panel__all" href="/notifications">All notifications</a>
		</div>
	{/if}
</div>

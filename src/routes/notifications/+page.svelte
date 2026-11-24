<script lang="ts">
	import { formatNotificationWhen } from '$lib/notifications';

	let { data, form } = $props();

	const unread = $derived(data.notifications.filter((item) => !item.readAt).length);
</script>

<svelte:head>
	<title>Tyr HQ | Notifications</title>
	<meta name="description" content="Notifications for your Tyr HQ account." />
</svelte:head>

<section class="mx-auto max-w-3xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">Account</p>
	<div class="mt-2 flex flex-wrap items-end justify-between gap-4">
		<h1 class="font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]">
			Notifications
		</h1>
		{#if data.available && unread > 0}
			<form method="POST" action="?/readAll">
				<button type="submit" class="text-sm text-[var(--hud-teal)] hover:underline">Mark all read</button>
			</form>
		{/if}
	</div>

	{#if form && 'error' in form && form.error}
		<p class="mt-4 text-sm text-[var(--hud-muted)]">{form.error}</p>
	{/if}

	{#if !data.available}
		<div class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8" style="box-shadow: var(--hud-surface-ghost);">
			<p class="text-sm leading-6 text-[var(--hud-muted)]">Notifications are not available on this deployment yet.</p>
		</div>
	{:else if data.notifications.length === 0}
		<div class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8" style="box-shadow: var(--hud-surface-ghost);">
			<p class="text-sm leading-6 text-[var(--hud-muted)]">No notifications yet.</p>
		</div>
	{:else}
		<div class="mt-8 flex flex-col gap-3">
			{#each data.notifications as item (item.id)}
				<article
					class="rounded-sm bg-[var(--hud-panel)] p-5"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<h2 class="font-[var(--font-display)] text-xl text-[var(--hud-text)]">{item.title}</h2>
						<p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-dim)]">
							{formatNotificationWhen(item.createdAt)}
							{#if !item.readAt}
								<span class="text-[var(--hud-teal)]">Unread</span>
							{/if}
						</p>
					</div>
					<p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--hud-muted)]">{item.body}</p>
					<form method="POST" action="?/read" class="mt-4 flex flex-wrap gap-4">
						<input type="hidden" name="id" value={item.id} />
						{#if item.link}
							<button
								type="submit"
								name="next"
								value={item.link}
								class="text-sm text-[var(--hud-teal)] hover:underline"
							>
								Open
							</button>
						{/if}
						{#if !item.readAt}
							<button type="submit" class="text-sm text-[var(--hud-muted)] hover:text-[var(--hud-text)]">
								Mark read
							</button>
						{/if}
					</form>
				</article>
			{/each}
		</div>
	{/if}
</section>

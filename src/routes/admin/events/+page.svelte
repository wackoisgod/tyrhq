<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let busyId = $state<string | null>(null);
	let actionError = $state('');
	let notes = $state<Record<string, string>>({});

	async function decide(id: string, decision: 'approve' | 'reject') {
		if (busyId) return;
		busyId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/events/${id}/decision`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ decision, notes: notes[id]?.trim() || null })
			});
			if (!res.ok) {
				actionError = await res.text();
				return;
			}
			delete notes[id];
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Decision failed.';
		} finally {
			busyId = null;
		}
	}

	function formatWhen(startsIso: string, endsIso: string | null): string {
		const opts: Intl.DateTimeFormatOptions = {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		};
		const startLabel = new Date(startsIso).toLocaleString(undefined, opts);
		if (!endsIso) return startLabel;
		return `${startLabel} → ${new Date(endsIso).toLocaleString(undefined, opts)}`;
	}
</script>

<svelte:head>
	<title>Tyr HQ | Event queue</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Reviewer
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Event queue
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Community-submitted events awaiting a decision. Approved events appear on
		<a href="/community/events" class="text-[var(--hud-teal)] hover:underline">the public calendar</a
		>; rejections stay visible only to the submitter, along with your note.
	</p>

	{#if actionError}
		<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
			{actionError}
		</p>
	{/if}

	{#if data.events.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">Nothing in the queue.</p>
		</div>
	{:else}
		<ul class="mt-8 flex flex-col gap-4">
			{#each data.events as event (event.id)}
				<li
					class="rounded-sm bg-[var(--hud-panel)] p-6"
					style="box-shadow: var(--hud-surface-ghost);"
				>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							{formatWhen(event.starts_at, event.ends_at)}
						</span>
						{#if event.location}
							<span
								class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
							>
								{event.location}
							</span>
						{/if}
						<span
							class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							By {event.submitter_display || '(no callsign)'}
						</span>
					</div>

					<h2 class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]">
						{event.title}
					</h2>
					{#if event.description}
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{event.description}</p>
					{/if}
					{#if event.url}
						<a
							href={event.url}
							target="_blank"
							rel="noreferrer"
							class="mt-2 inline-block break-all font-mono text-[11px] text-[var(--hud-teal)] hover:underline"
						>
							{event.url}
						</a>
					{/if}

					<div class="mt-4 flex flex-wrap items-center gap-2">
						<input
							type="text"
							bind:value={notes[event.id]}
							maxlength="2000"
							placeholder="Optional note to the submitter…"
							class="hud-input min-w-[240px] flex-1 rounded-sm px-3 py-2 text-xs"
						/>
						<button
							type="button"
							disabled={busyId === event.id}
							onclick={() => decide(event.id, 'approve')}
							class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
						>
							Approve
						</button>
						<button
							type="button"
							disabled={busyId === event.id}
							onclick={() => decide(event.id, 'reject')}
							class="hud-cta-ghost px-4 py-2 text-xs disabled:opacity-50"
						>
							Reject
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

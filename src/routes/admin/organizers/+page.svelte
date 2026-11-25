<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let busyId = $state<string | null>(null);
	let actionError = $state('');
	let notes = $state<Record<string, string>>({});

	async function post(url: string, body: unknown) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			actionError = await res.text();
			return false;
		}
		return true;
	}

	async function decide(id: string, decision: 'approve' | 'reject') {
		if (busyId) return;
		busyId = id;
		actionError = '';
		try {
			const ok = await post(`/api/admin/organizer-applications/${id}/decision`, {
				decision,
				note: notes[id]?.trim() || null
			});
			if (!ok) return;
			delete notes[id];
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Decision failed.';
		} finally {
			busyId = null;
		}
	}

	async function revoke(id: string, name: string) {
		if (busyId) return;
		if (!confirm(`Revoke organizer access for ${name || 'this pilot'}? Their tournaments stay.`)) return;
		busyId = id;
		actionError = '';
		try {
			const ok = await post(`/api/admin/organizers/${id}/revoke`, {});
			if (!ok) return;
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not revoke organizer access.';
		} finally {
			busyId = null;
		}
	}

	async function unlist(id: string, name: string) {
		if (busyId) return;
		if (!confirm(`Take “${name}” off the public list? It is not deleted.`)) return;
		busyId = id;
		actionError = '';
		try {
			const ok = await post(`/api/admin/tournaments/${id}/unlist`, {
				note: notes[`unlist:${id}`]?.trim() || null
			});
			if (!ok) return;
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not unlist the tournament.';
		} finally {
			busyId = null;
		}
	}
</script>

<svelte:head>
	<title>Tyr HQ | Organizer review</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">Admin</p>
	<h1 class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]">
		Organizers
	</h1>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Approve pilots who want to run tournaments. Approved organizers publish immediately. You can
		also take a tournament off the public list or remove organizer access. Past events stay.
	</p>

	{#if actionError}
		<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">{actionError}</p>
	{/if}

	<h2 class="mt-10 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
		Applications ({data.applications.length})
	</h2>
	{#if data.applications.length === 0}
		<div class="mt-3 rounded-sm bg-[var(--hud-panel)] p-8 text-center" style="box-shadow: var(--hud-surface-ghost);">
			<p class="text-[var(--hud-muted)]">No applications waiting.</p>
		</div>
	{:else}
		<ul class="mt-3 flex flex-col gap-4">
			{#each data.applications as application (application.id)}
				<li class="rounded-sm bg-[var(--hud-panel)] p-6" style="box-shadow: var(--hud-surface-ghost);">
					<p class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
						{application.applicantName || '(no callsign)'} · {application.discordHandle}
					</p>
					<h3 class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]">
						{application.format} · {application.region} · {application.frequency}
					</h3>
					<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{application.pastEvents}</p>
					<p class="mt-2 text-xs text-[var(--hud-dim)]">About {application.expectedPlayerCount} players</p>
					<div class="mt-4 flex flex-wrap items-center gap-2">
						<input
							type="text"
							bind:value={notes[application.id]}
							maxlength="2000"
							placeholder="Optional note to the applicant…"
							class="hud-input min-w-[240px] flex-1 rounded-sm px-3 py-2 text-xs"
						/>
						<button
							type="button"
							disabled={busyId === application.id}
							onclick={() => decide(application.id, 'approve')}
							class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
						>
							Approve
						</button>
						<button
							type="button"
							disabled={busyId === application.id}
							onclick={() => decide(application.id, 'reject')}
							class="hud-cta-ghost px-4 py-2 text-xs disabled:opacity-50"
						>
							Reject
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="mt-10 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
		Organizer access ({data.organizers.length})
	</h2>
	{#if data.organizers.length === 0}
		<p class="mt-3 text-sm text-[var(--hud-muted)]">Nobody has organizer access.</p>
	{:else}
		<ul class="mt-3 flex flex-col gap-2">
			{#each data.organizers as organizer (organizer.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-[var(--hud-panel)] px-4 py-3">
					<span class="text-sm text-[var(--hud-text)]">{organizer.displayName || '(no callsign)'}</span>
					<button
						type="button"
						disabled={busyId === organizer.id}
						onclick={() => revoke(organizer.id, organizer.displayName)}
						class="hud-cta-ghost px-3 py-2 text-xs disabled:opacity-50"
					>
						Revoke
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="mt-10 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
		Public tournaments
	</h2>
	{#if data.tournaments.length === 0}
		<p class="mt-3 text-sm text-[var(--hud-muted)]">No published tournaments.</p>
	{:else}
		<ul class="mt-3 flex flex-col gap-2">
			{#each data.tournaments as tournament (tournament.id)}
				<li class="rounded-sm bg-[var(--hud-panel)] px-4 py-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<a href="/tournaments/{tournament.slug}" class="text-sm text-[var(--hud-text)] hover:text-[var(--hud-teal)]">
								{tournament.name}
							</a>
							<p class="mt-1 text-xs text-[var(--hud-dim)]">
								{tournament.status} · {tournament.organizerName || 'Unknown organizer'}
								{#if tournament.unlistedAt}
									· Off the public list
								{/if}
							</p>
						</div>
						{#if !tournament.unlistedAt}
							<button
								type="button"
								disabled={busyId === tournament.id}
								onclick={() => unlist(tournament.id, tournament.name)}
								class="hud-cta-ghost px-3 py-2 text-xs disabled:opacity-50"
							>
								Unlist
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

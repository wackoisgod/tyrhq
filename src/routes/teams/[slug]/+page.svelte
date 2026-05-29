<script lang="ts">
	let { data, form } = $props();

	let showSettings = $state(false);
	const canManage = $derived(data.isCaptain || data.role === 'admin');

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.team.name}</title>
</svelte:head>

<section class="mx-auto max-w-6xl px-4 py-8 md:px-6">
	<div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
		<aside class="hud-panel p-6">
			{#if data.team.logoUrl}
				<img src={data.team.logoUrl} alt="" class="aspect-square w-28 rounded-sm object-cover" />
			{/if}
			<p class="mt-5 hud-eyebrow">Team</p>
			<h1 class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]">
				{data.team.name}
			</h1>
			<p class="mt-3 text-sm text-[var(--hud-muted)]">Captain: {data.team.captainName || 'Unknown'}</p>
			<p class="mt-2 hud-numeric text-2xl text-[var(--hud-text)]">
				{data.team.record.wins}-{data.team.record.losses}
			</p>
			{#if data.team.description}
				<p class="mt-4 text-sm leading-6 text-[var(--hud-muted)]">{data.team.description}</p>
			{/if}

			{#if form?.error}
				<div class="mt-4 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">
					{form.error}
				</div>
			{:else if form?.success}
				<div class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]">
					{form.success}
				</div>
			{/if}

			<div class="mt-5 flex flex-wrap gap-2">
				{#if !data.userId}
					<a href={data.loginHref} class="hud-cta px-4 py-3">Sign In To Join</a>
				{:else if data.isMember}
					<form method="POST" action="?/leave">
						<input type="hidden" name="teamId" value={data.team.id} />
						<button class="hud-cta-ghost px-4 py-3">Leave Team</button>
					</form>
				{:else}
					<form method="POST" action="?/join">
						<input type="hidden" name="teamId" value={data.team.id} />
						<button class="hud-cta px-4 py-3">Join Team</button>
					</form>
				{/if}
				{#if canManage}
					<button
						type="button"
						class="hud-cta-outline px-4 py-3"
						aria-expanded={showSettings}
						onclick={() => (showSettings = !showSettings)}
					>
						{showSettings ? 'Close Settings' : 'Team Settings'}
					</button>
				{/if}
			</div>

			{#if canManage && showSettings}
				<form method="POST" action="?/update" class="mt-6 flex flex-col gap-3 border-t border-[var(--hud-variant)] pt-5">
					<p class="hud-label">Edit Team</p>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Name</span>
						<input
							name="name"
							required
							minlength="3"
							maxlength="40"
							value={data.team.name}
							class="hud-input px-3 py-2"
						/>
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Description</span>
						<textarea name="description" maxlength="500" rows="4" class="hud-input px-3 py-2">{data.team.description ?? ''}</textarea>
					</label>
					<button class="hud-cta px-4 py-3">Save Team</button>
				</form>

				<form method="POST" action="?/logo" enctype="multipart/form-data" class="mt-6 flex flex-col gap-3">
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Team Logo</span>
						<input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hud-input px-3 py-2" />
					</label>
					<button class="hud-cta-outline px-4 py-2 text-xs">Upload Logo</button>
				</form>
			{/if}
		</aside>

		<div class="flex flex-col gap-6">
			<section>
				<p class="hud-label">Roster ({data.team.members.length})</p>
				<div class="mt-3 overflow-hidden rounded-sm bg-[var(--hud-panel)]" style="box-shadow: var(--hud-surface-ghost);">
					{#each data.team.members as member}
						<div class="flex items-center justify-between border-b border-[var(--hud-variant)]/50 px-4 py-3 text-sm">
							<span class="text-[var(--hud-text)]">{member.displayName || 'Pilot'}</span>
							<span class="text-xs uppercase tracking-[0.18em] text-[var(--hud-dim)]">{member.role}</span>
						</div>
					{/each}
				</div>
			</section>

			<section>
				<p class="hud-label">Tournaments</p>
				<div class="mt-3 grid gap-3">
					{#each data.team.tournaments as entry}
						<a href="/tournaments/{entry.tournament.slug}" class="rounded-sm bg-[var(--hud-panel)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]" style="box-shadow: var(--hud-surface-ghost);">
							<p class="font-semibold uppercase text-[var(--hud-text)]">{entry.tournament.name}</p>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">
								{entry.tournament.status} · {formatDate(entry.tournament.startsAt)}
							</p>
						</a>
					{:else}
						<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">This team has not registered for any tournaments.</div>
					{/each}
				</div>
			</section>
		</div>
	</div>
</section>

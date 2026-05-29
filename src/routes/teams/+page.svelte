<script lang="ts">
	let { data, form } = $props();

	const canCreate = $derived(data.isSignedIn && data.captainTeams.length === 0);
	const showCreateForm = $derived(canCreate && data.showCreate);
</script>

<svelte:head>
	<title>Tyr HQ | Teams</title>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">Rosters</div>
			<h1 class="tyr-section-title">Teams</h1>
		</div>
		<div class="flex flex-wrap gap-2">
			<a href="/tournaments" class="hud-cta-ghost px-4 py-3">Tournaments</a>
			{#if !data.isSignedIn}
				<a href="/auth?next=/teams" class="hud-cta px-4 py-3">Sign In To Create</a>
			{:else if canCreate}
				<a href={showCreateForm ? '/teams' : '/teams?create=1'} class="hud-cta px-4 py-3">
					{showCreateForm ? 'View Teams' : 'Create Team'}
				</a>
			{:else}
				<a href="/teams/{data.captainTeams[0].slug}" class="hud-cta px-4 py-3">Edit My Team</a>
			{/if}
		</div>
	</div>

	{#if !canCreate && data.isSignedIn}
		<div class="mt-6 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-muted)]">
			You captain <a class="hud-link" href="/teams/{data.captainTeams[0].slug}">{data.captainTeams[0].name}</a>. You can join other teams, but each account can only captain one active team.
		</div>
	{/if}

	{#if form?.error}
		<div class="mt-6 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">
			{form.error}
		</div>
	{/if}

	{#if showCreateForm}
		<form method="POST" action="?/create" class="mt-6 hud-panel flex max-w-2xl flex-col gap-4 p-6">
			<div>
				<p class="hud-label">Create Team</p>
				<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
					The creator becomes captain. You can only captain one active team.
				</p>
			</div>

			<label class="flex flex-col gap-1.5">
				<span class="hud-label">Team Name</span>
				<input name="name" required minlength="3" maxlength="40" class="hud-input px-3 py-2" />
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="hud-label">Description</span>
				<textarea name="description" maxlength="500" rows="4" class="hud-input px-3 py-2"></textarea>
			</label>

			<button class="hud-cta px-5 py-3">Create Team</button>
		</form>
	{:else}
		<section class="mt-6">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p class="hud-label">Active Teams</p>
					<p class="mt-2 text-sm text-[var(--hud-muted)]">Open a team to view its roster, record, tournaments, and captain tools.</p>
				</div>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
				{#each data.teams as team}
					<a
						href="/teams/{team.slug}"
						class="team-entry group"
					>
						<div class="team-entry__mark">
							{#if team.logoUrl}
								<img src={team.logoUrl} alt="" class="h-full w-full object-cover" />
							{:else}
								<span>{team.name.slice(0, 2)}</span>
							{/if}
						</div>
						<h2 class="mt-3 truncate text-center text-base font-semibold text-[var(--hud-text)]">{team.name}</h2>
					</a>
				{:else}
					<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No teams yet.</div>
				{/each}
			</div>
		</section>
	{/if}
</section>

<style>
	.team-entry {
		display: block;
		min-width: 0;
		text-decoration: none;
	}

	.team-entry__mark {
		aspect-ratio: 1;
		width: min(100%, 10rem);
		margin-inline: auto;
		overflow: hidden;
		border: 2px solid color-mix(in srgb, var(--hud-variant) 72%, transparent);
		border-radius: 999px;
		background:
			radial-gradient(circle at 35% 25%, rgba(117, 241, 244, 0.2), transparent 35%),
			var(--hud-inset);
		color: var(--hud-teal);
		display: grid;
		place-items: center;
		font-family: var(--font-display);
		font-size: clamp(1.45rem, 4vw, 2.4rem);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		box-shadow: inset 0 0 0 3px rgba(10, 16, 28, 0.82), var(--hud-surface-ghost);
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease,
			transform 140ms ease;
	}

	.team-entry:hover .team-entry__mark {
		border-color: var(--hud-teal);
		box-shadow: inset 0 0 0 3px rgba(10, 16, 28, 0.82), 0 0 0 1px rgba(117, 241, 244, 0.45), var(--hud-surface-ghost);
		transform: translateY(-2px);
	}

	.team-entry:hover h2 {
		color: var(--hud-teal);
	}
</style>

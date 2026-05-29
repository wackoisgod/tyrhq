<script lang="ts">
	let { data } = $props();

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}

	function registrationLabel(tournament: (typeof data.upcoming)[number]) {
		if (tournament.status === 'cancelled') return 'Cancelled';
		if (tournament.status === 'completed') return 'Completed';
		if (tournament.status === 'in_progress') return 'In progress';
		if (tournament.registrationMode === 'manual_bracket') return 'Invite bracket';
		if (!tournament.registrationClosesAt) return 'Registration open';

		return new Date(tournament.registrationClosesAt).getTime() <= Date.now()
			? 'Registration closed'
			: 'Registration open';
	}

	function registrationMeta(tournament: (typeof data.upcoming)[number]) {
		if (tournament.registrationMode === 'manual_bracket') return 'Teams are seeded by the organizer';
		if (!tournament.registrationClosesAt) return 'No registration close time set';

		const closeDate = formatDate(tournament.registrationClosesAt);
		return new Date(tournament.registrationClosesAt).getTime() <= Date.now()
			? `Closed ${closeDate}`
			: `Closes ${closeDate}`;
	}
</script>

<svelte:head>
	<title>Tyr HQ | Tournaments</title>
</svelte:head>

<section class="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 md:px-6">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">Competition</div>
			<h1 class="tyr-section-title">Tournaments</h1>
		</div>
		<div class="flex flex-wrap gap-2">
			<a href="/teams" class="hud-cta-ghost px-4 py-3">Teams</a>
			<a href="/tournaments/manage" class="hud-cta px-4 py-3">Organizer Tools</a>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
		<section>
			<h2 class="hud-label">Upcoming</h2>
			<div class="mt-3 grid gap-3">
				{#each data.upcoming as tournament}
					<a
						href="/tournaments/{tournament.slug}"
						class="tournament-card group"
						style={tournament.logoUrl ? `--tournament-image: url('${tournament.logoUrl}')` : ''}
					>
						<div class="tournament-card__content">
							<p class="hud-eyebrow">{registrationLabel(tournament)}</p>
							<h3 class="mt-2 text-2xl font-semibold uppercase text-[var(--hud-text)]">
								{tournament.name}
							</h3>
							<p class="mt-3 text-sm text-[var(--hud-text)]">{formatDate(tournament.startsAt)}</p>
							<p class="tournament-card__meta">
								{registrationMeta(tournament)}
							</p>
							{#if tournament.summary}
								<p class="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
									{tournament.summary}
								</p>
							{/if}
						</div>
					</a>
				{:else}
					<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No upcoming tournaments yet.</div>
				{/each}
			</div>
		</section>

		<section>
			<h2 class="hud-label">Past</h2>
			<div class="mt-3 grid gap-3">
				{#each data.past as tournament}
					<a
						href="/tournaments/{tournament.slug}"
						class="tournament-card tournament-card--compact group"
						style={tournament.logoUrl ? `--tournament-image: url('${tournament.logoUrl}')` : ''}
					>
						<div class="tournament-card__content">
							<p class="hud-eyebrow">{registrationLabel(tournament)}</p>
							<p class="mt-2 font-semibold uppercase text-[var(--hud-text)]">{tournament.name}</p>
							<p class="mt-2 text-xs text-[var(--hud-muted)]">{formatDate(tournament.startsAt)}</p>
							<p class="tournament-card__meta tournament-card__meta--compact">
								{registrationMeta(tournament)}
							</p>
						</div>
					</a>
				{:else}
					<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No completed tournaments yet.</div>
				{/each}
			</div>
		</section>
	</div>
</section>

<style>
	.tournament-card {
		position: relative;
		isolation: isolate;
		display: block;
		min-height: 180px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--hud-variant) 82%, transparent);
		border-radius: 2px;
		background:
			linear-gradient(100deg, rgba(5, 10, 20, 0.98) 0%, rgba(5, 10, 20, 0.9) 28%, rgba(5, 10, 20, 0.48) 48%, rgba(5, 10, 20, 0.08) 75%, rgba(5, 10, 20, 0.14) 100%),
			var(--tournament-image, linear-gradient(135deg, rgba(117, 241, 244, 0.16), rgba(116, 95, 255, 0.12))),
			var(--hud-panel);
		background-position: center;
		background-size: cover;
		box-shadow: var(--hud-surface-ghost);
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease,
			transform 140ms ease;
	}

	.tournament-card::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(90deg, rgba(117, 241, 244, 0.09), transparent 34%),
			repeating-linear-gradient(
				90deg,
				rgba(255, 255, 255, 0.035) 0,
				rgba(255, 255, 255, 0.035) 1px,
				transparent 1px,
				transparent 80px
			);
		opacity: 0.38;
	}

	.tournament-card:hover {
		border-color: color-mix(in srgb, var(--hud-teal) 70%, var(--hud-variant));
		box-shadow: var(--hud-surface-ghost), inset 3px 0 0 0 var(--hud-teal);
		transform: translateY(-1px);
	}

	.tournament-card__content {
		max-width: min(34rem, 72%);
		padding: 1.5rem;
	}

	.tournament-card__meta {
		margin-top: 0.35rem;
		color: color-mix(in srgb, var(--hud-text) 82%, var(--hud-teal));
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
		text-transform: uppercase;
	}

	.tournament-card__meta--compact {
		font-size: 0.64rem;
	}

	.tournament-card--compact {
		min-height: 128px;
	}

	.tournament-card--compact .tournament-card__content {
		padding: 1.1rem;
	}
</style>

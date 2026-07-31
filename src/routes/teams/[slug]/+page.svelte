<script lang="ts">
	let { data, form } = $props();

	let showSettings = $state(false);
	const canManage = $derived(data.isCaptain || data.role === 'admin');
	const tournamentTitles = $derived(
		data.team.tournaments.filter((entry) => entry.result.tier === 'champion').length
	);
	const topFourFinishes = $derived(
		data.team.tournaments.filter((entry) => ['champion', 'runner_up', 'semifinalist'].includes(entry.result.tier)).length
	);
	const seriesPlayed = $derived(data.team.record.wins + data.team.record.losses);
	const winRate = $derived(
		seriesPlayed > 0 ? Math.round((data.team.record.wins / seriesPlayed) * 100) : 0
	);
	const teamInitials = $derived(initials(data.team.name));

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString();
	}

	function initials(name: string | null | undefined) {
		return (name || 'Tyr')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.team.name}</title>
</svelte:head>

<section class="team-page mx-auto max-w-6xl px-4 py-8 md:px-6">
	<div class="team-layout">
		<aside class="team-profile-card">
			<div class="team-profile-card__beam" aria-hidden="true"></div>
			<div class="team-profile-card__header">
				<div class="team-crest" class:team-crest--logo={Boolean(data.team.logoUrl)}>
					{#if data.team.logoUrl}
						<img src={data.team.logoUrl} alt="{data.team.name} logo" />
					{:else}
						<span>{teamInitials}</span>
					{/if}
				</div>
				<div>
					<p class="hud-eyebrow">Competitive Team</p>
					<p class="team-ready"><i></i> Active roster</p>
				</div>
			</div>
			<h1 class="team-name">
				{data.team.name}
			</h1>
			<div class="team-captain">
				<span class="hud-label">Squad leader</span>
				<a href="/players/{data.team.captainId}">{data.team.captainName || 'Unknown'}</a>
			</div>
			<div class="team-record">
				<div>
					<span class="hud-label">Series record</span>
					<strong class="hud-numeric">{data.team.record.wins}<small>–</small>{data.team.record.losses}</strong>
				</div>
				<div class="team-record__rate">
					<span>{winRate}%</span>
					<small>Win rate</small>
				</div>
			</div>
			{#if tournamentTitles > 0 || topFourFinishes > 0}
				<div class="team-honors">
					<div class="team-honor" class:team-honor--title={tournamentTitles > 0}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v3c0 3.2-2 5.8-5 6.8C9 12.8 7 10.2 7 7V4Zm-3 1h3v2H6c0 1.8.8 3 2.5 3.8l-1 1.7C5.2 11.4 4 9.6 4 7V5Zm13 0h3v2c0 2.6-1.2 4.4-3.5 5.5l-1-1.7C17.2 10 18 8.8 18 7h-1V5Zm-6 8h2v4h3v2H8v-2h3v-4Z" /></svg>
						<span class="hud-label">Titles</span>
						<strong class="hud-numeric">{tournamentTitles}</strong>
					</div>
					<div class="team-honor">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.3-4.4 2.3.8-5-3.6-3.5 5-.7L12 3Z" /></svg>
						<span class="hud-label">Top 4</span>
						<strong class="hud-numeric">{topFourFinishes}</strong>
					</div>
				</div>
			{/if}
			{#if data.team.description}
				<p class="team-description">{data.team.description}</p>
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
					<a href={data.loginHref} class="hud-cta px-4 py-3">Sign In To Request Access</a>
				{:else if data.isMember}
					{#if data.isCaptain}
						<span class="hud-cta-ghost px-4 py-3">Team Captain</span>
					{:else}
						<form method="POST" action="?/leave">
							<input type="hidden" name="teamId" value={data.team.id} />
							<button class="hud-cta-ghost px-4 py-3">Leave Team</button>
						</form>
					{/if}
				{:else if data.joinRequestStatus === 'pending'}
					<form method="POST" action="?/cancelJoin">
						<input type="hidden" name="teamId" value={data.team.id} />
						<button class="hud-cta-ghost px-4 py-3">Cancel Join Request</button>
					</form>
				{:else}
					<form method="POST" action="?/requestJoin">
						<input type="hidden" name="teamId" value={data.team.id} />
						<button class="hud-cta px-4 py-3">Request To Join</button>
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

		<div class="team-content">
			<section class="team-section">
				<div class="team-section__heading">
					<div>
						<p class="hud-eyebrow">Roster</p>
						<h2>Active lineup</h2>
					</div>
					<span>{data.team.members.length} pilots</span>
				</div>
				<div class="team-roster">
					{#each data.team.members as member, index}
						<div class="team-roster__slot">
							<span class="team-roster__number">{String(index + 1).padStart(2, '0')}</span>
							<span class="team-roster__avatar">{initials(member.displayName)}</span>
							<a href="/players/{member.userId}" class="team-roster__pilot">
								<strong>{member.displayName || 'Pilot'}</strong>
								<small>View competitive profile</small>
							</a>
							<span class="team-role" class:team-role--captain={member.role === 'captain'}>{member.role}</span>
						</div>
					{/each}
				</div>
			</section>

			{#if canManage}
				<section class="team-section">
					<div class="team-section__heading team-section__heading--compact">
						<div>
							<p class="hud-eyebrow">Recruitment</p>
							<h2>Join requests</h2>
						</div>
						<span>{data.pendingJoinRequests.length} pending</span>
					</div>
					<div class="mt-3 overflow-hidden rounded-sm bg-[var(--hud-panel)]" style="box-shadow: var(--hud-surface-ghost);">
						{#each data.pendingJoinRequests as request}
							<div class="flex flex-col gap-3 border-b border-[var(--hud-variant)]/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<p class="text-sm text-[var(--hud-text)]">{request.displayName || 'Pilot'}</p>
									<p class="mt-1 text-xs text-[var(--hud-dim)]">Requested {formatDate(request.requestedAt)}</p>
								</div>
								<form method="POST" action="?/reviewJoin" class="flex gap-2">
									<input type="hidden" name="teamId" value={data.team.id} />
									<input type="hidden" name="applicantId" value={request.userId} />
									<button name="decision" value="approve" class="hud-cta px-3 py-2 text-xs">Approve</button>
									<button name="decision" value="reject" class="hud-cta-ghost px-3 py-2 text-xs">Reject</button>
								</form>
							</div>
						{:else}
							<div class="px-4 py-4 text-sm text-[var(--hud-muted)]">No pending join requests.</div>
						{/each}
					</div>
				</section>
			{/if}

			<section class="team-section">
				<div class="team-section__heading">
					<div>
						<p class="hud-eyebrow">Competition history</p>
						<h2>Tournaments</h2>
					</div>
					<span>{data.team.tournaments.length} events</span>
				</div>
				<div class="team-tournaments">
					{#each data.team.tournaments as entry, index}
						<a
							href="/tournaments/{entry.tournament.slug}"
							class="team-tournament-card"
							class:team-tournament-card--champion={entry.result.tier === 'champion'}
							class:team-tournament-card--runner-up={entry.result.tier === 'runner_up'}
							class:team-tournament-card--top-four={entry.result.tier === 'semifinalist'}
							class:team-tournament-card--active={entry.result.tier === 'active'}
						>
							<span class="team-tournament-card__index">EVENT {String(index + 1).padStart(2, '0')}</span>
							{#if entry.result.tier === 'champion'}
								<span class="team-tournament-card__trophy" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4h10v3c0 3.2-2 5.8-5 6.8C9 12.8 7 10.2 7 7V4Zm-3 1h3v2H6c0 1.8.8 3 2.5 3.8l-1 1.7C5.2 11.4 4 9.6 4 7V5Zm13 0h3v2c0 2.6-1.2 4.4-3.5 5.5l-1-1.7C17.2 10 18 8.8 18 7h-1V5Zm-6 8h2v4h3v2H8v-2h3v-4Z" /></svg></span>
							{/if}
							<div class="flex items-start justify-between gap-4">
								<p class="team-tournament-card__name">{entry.tournament.name}</p>
								<span
									class="team-result-badge"
									class:team-result-badge--champion={entry.result.tier === 'champion'}
									class:team-result-badge--runner-up={entry.result.tier === 'runner_up'}
								>
									{entry.result.placementLabel ?? entry.result.label}
								</span>
							</div>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">
								{formatDate(entry.tournament.startsAt)}{entry.seed ? ` · Seed #${entry.seed}` : ''}
							</p>
							<div class="team-tournament-card__footer">
								<span class="team-tournament-card__result">
									{#if entry.result.tier === 'active'}<i class="live-pulse"></i>{/if}
									{entry.result.label}
								</span>
								{#if entry.result.placementLabel || entry.result.wins + entry.result.losses > 0}
									<span class="hud-numeric text-[var(--hud-muted)]">{entry.result.wins}-{entry.result.losses} series</span>
								{/if}
								<span class="team-tournament-card__arrow" aria-hidden="true">→</span>
							</div>
						</a>
					{:else}
						<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">This team has not registered for any tournaments.</div>
					{/each}
				</div>
			</section>
		</div>
	</div>
</section>

<style>
	.team-page {
		position: relative;
		isolation: isolate;
	}

	.team-page::before {
		position: absolute;
		z-index: -1;
		top: -2rem;
		left: 0;
		width: min(52rem, 100%);
		height: 30rem;
		background: radial-gradient(ellipse, color-mix(in srgb, var(--hud-teal) 9%, transparent), transparent 68%);
		content: '';
		pointer-events: none;
	}

	.team-layout {
		display: grid;
		gap: 1.75rem;
	}

	.team-profile-card {
		position: relative;
		align-self: start;
		overflow: hidden;
		border: 1px solid var(--hud-variant);
		border-left: 2px solid var(--hud-teal);
		background: linear-gradient(145deg, color-mix(in srgb, var(--hud-teal) 6%, var(--hud-panel)), var(--hud-panel) 44%);
		padding: 1.5rem;
		box-shadow: 0 20px 60px rgb(0 0 0 / 24%), var(--hud-surface-ghost);
	}

	.team-profile-card::after {
		position: absolute;
		right: -5rem;
		bottom: -7rem;
		width: 15rem;
		height: 15rem;
		border: 1px solid color-mix(in srgb, var(--hud-teal) 14%, transparent);
		transform: rotate(45deg);
		content: '';
		pointer-events: none;
	}

	.team-profile-card__beam {
		position: absolute;
		top: 0;
		right: 0;
		width: 9rem;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--hud-teal));
		box-shadow: 0 0 18px color-mix(in srgb, var(--hud-teal) 70%, transparent);
	}

	.team-profile-card__header,
	.team-ready,
	.team-captain,
	.team-record,
	.team-section__heading,
	.team-tournament-card__footer,
	.team-tournament-card__result {
		display: flex;
		align-items: center;
	}

	.team-profile-card__header {
		gap: 1rem;
	}

	.team-crest {
		display: grid;
		width: 5.25rem;
		height: 5.25rem;
		flex: 0 0 auto;
		place-items: center;
		clip-path: polygon(50% 0, 93% 22%, 84% 78%, 50% 100%, 16% 78%, 7% 22%);
		background: linear-gradient(145deg, color-mix(in srgb, var(--hud-teal) 75%, white), color-mix(in srgb, var(--hud-teal) 18%, var(--hud-inset)) 55%);
		box-shadow: 0 0 32px color-mix(in srgb, var(--hud-teal) 22%, transparent);
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: #071017;
	}

	.team-crest--logo { background: var(--hud-inset); }
	.team-crest img { width: 100%; height: 100%; object-fit: cover; }

	.team-ready {
		gap: 0.45rem;
		margin-top: 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--hud-muted);
	}

	.team-ready i,
	.live-pulse {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 999px;
		background: var(--hud-teal);
		box-shadow: 0 0 10px var(--hud-teal);
	}

	.team-name {
		position: relative;
		margin-top: 1.5rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 4vw, 3rem);
		font-weight: 800;
		line-height: 0.98;
		text-transform: uppercase;
		text-wrap: balance;
		color: var(--hud-text);
	}

	.team-captain {
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.25rem;
		border-top: 1px solid var(--hud-variant);
		padding-top: 0.85rem;
	}

	.team-captain a { font-size: 0.8rem; font-weight: 700; color: var(--hud-text); }
	.team-captain a:hover { color: var(--hud-teal); }

	.team-record {
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.35rem;
		border: 1px solid color-mix(in srgb, var(--hud-teal) 28%, var(--hud-variant));
		background: linear-gradient(110deg, color-mix(in srgb, var(--hud-teal) 8%, var(--hud-inset)), var(--hud-inset));
		padding: 1rem;
		box-shadow: inset 2px 0 0 var(--hud-teal);
	}

	.team-record strong { display: block; margin-top: 0.3rem; font-size: 2rem; line-height: 1; color: var(--hud-text); }
	.team-record strong small { padding-inline: 0.2rem; color: var(--hud-dim); }
	.team-record__rate { text-align: right; }
	.team-record__rate span { display: block; font-family: var(--font-mono); font-weight: 700; color: var(--hud-teal); }
	.team-record__rate small { font-size: 0.65rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-dim); }

	.team-honors {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 0.65rem;
	}

	.team-honors .team-honor { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; }
	.team-honor svg { width: 1rem; fill: var(--hud-dim); }
	.team-honor--title svg { fill: #ffd166; }

	.team-description {
		margin-top: 1.2rem;
		border-left: 1px solid var(--hud-variant);
		padding-left: 0.9rem;
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--hud-muted);
	}

	.team-content { display: flex; min-width: 0; flex-direction: column; gap: 2rem; }

	.team-section__heading {
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--hud-variant);
		padding-bottom: 0.75rem;
	}

	.team-section__heading h2 { margin-top: 0.28rem; font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; line-height: 1; text-transform: uppercase; color: var(--hud-text); }
	.team-section__heading > span { font-family: var(--font-mono); font-size: 0.65rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-dim); }
	.team-section__heading--compact h2 { font-size: 1.15rem; }

	.team-roster {
		overflow: hidden;
		margin-top: 0.75rem;
		border: 1px solid var(--hud-variant);
		background: color-mix(in srgb, var(--hud-panel) 92%, transparent);
		box-shadow: 0 14px 40px rgb(0 0 0 / 14%), var(--hud-surface-ghost);
	}

	.team-roster__slot {
		display: grid;
		grid-template-columns: 2.1rem 2.25rem 1fr auto;
		align-items: center;
		gap: 0.85rem;
		min-height: 3.55rem;
		border-bottom: 1px solid color-mix(in srgb, var(--hud-variant) 65%, transparent);
		padding: 0.55rem 1rem;
		transition: background 140ms ease, padding-left 140ms ease;
	}

	.team-roster__slot:last-child { border-bottom: 0; }
	.team-roster__slot:hover { background: color-mix(in srgb, var(--hud-teal) 5%, var(--hud-panel)); padding-left: 1.15rem; }
	.team-roster__number { font-family: var(--font-mono); font-size: 0.66rem; color: var(--hud-dim); }
	.team-roster__avatar { display: grid; width: 2.25rem; height: 2.25rem; place-items: center; border: 1px solid color-mix(in srgb, var(--hud-teal) 35%, var(--hud-variant)); background: var(--hud-inset); font-family: var(--font-mono); font-size: 0.62rem; font-weight: 700; color: var(--hud-teal); }
	.team-roster__pilot strong, .team-roster__pilot small { display: block; }
	.team-roster__pilot strong { font-size: 0.82rem; color: var(--hud-text); }
	.team-roster__pilot small { margin-top: 0.15rem; font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hud-dim); }
	.team-roster__pilot:hover strong { color: var(--hud-teal); }
	.team-role { border: 1px solid var(--hud-variant); padding: 0.3rem 0.5rem; font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.13em; text-transform: uppercase; color: var(--hud-muted); }
	.team-role--captain { border-color: color-mix(in srgb, var(--hud-teal) 45%, var(--hud-variant)); color: var(--hud-teal); }

	.team-tournaments { display: grid; gap: 0.8rem; margin-top: 0.75rem; }

	.team-tournaments .team-tournament-card {
		position: relative;
		overflow: hidden;
		background: linear-gradient(100deg, color-mix(in srgb, var(--hud-teal) 4%, var(--hud-panel)), var(--hud-panel) 55%);
		padding: 1rem 1.15rem;
		box-shadow: 0 10px 28px rgb(0 0 0 / 12%), var(--hud-surface-ghost);
	}

	.team-tournaments .team-tournament-card--champion { background: linear-gradient(100deg, color-mix(in srgb, #ffd166 12%, var(--hud-panel)), var(--hud-panel) 58%); }
	.team-tournament-card--active { border-left-color: var(--hud-teal); }
	.team-tournament-card__index { display: block; margin-bottom: 0.5rem; font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.16em; color: var(--hud-dim); }
	.team-tournament-card__name { position: relative; font-family: var(--font-display); font-size: 1rem; font-weight: 700; text-transform: uppercase; color: var(--hud-text); }
	.team-tournament-card__trophy { position: absolute; right: 7.5rem; bottom: -1.4rem; opacity: 0.09; transform: rotate(-8deg); }
	.team-tournament-card__trophy svg { width: 6rem; fill: #ffd166; }
	.team-tournament-card__footer { gap: 0.75rem; margin-top: 0.85rem; border-top: 1px solid var(--hud-variant); padding-top: 0.7rem; font-size: 0.68rem; }
	.team-tournament-card__result { gap: 0.45rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-teal); }
	.team-tournament-card--champion .team-tournament-card__result { color: #ffd166; }
	.team-tournament-card__arrow { margin-left: auto; font-size: 1rem; color: var(--hud-dim); transition: color 160ms ease, transform 160ms ease; }
	.team-tournament-card:hover .team-tournament-card__arrow { color: var(--hud-teal); transform: translateX(3px); }
	.live-pulse { animation: team-pulse 1.8s ease-out infinite; }
	.team-honor {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border: 1px solid var(--hud-variant);
		background: var(--hud-inset);
		padding: 0.65rem 0.75rem;
	}

	.team-honor strong {
		color: var(--hud-text);
		font-size: 1.15rem;
	}

	.team-honor--title {
		border-color: color-mix(in srgb, #ffd166 45%, var(--hud-variant));
		box-shadow: inset 2px 0 0 #ffd166;
	}

	.team-honor--title strong {
		color: #ffd166;
	}

	.team-tournament-card {
		display: block;
		border-left: 2px solid var(--hud-variant);
		border-radius: 0.125rem;
		background: var(--hud-panel);
		padding: 1rem;
		box-shadow: var(--hud-surface-ghost);
		transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
	}

	.team-tournament-card:hover {
		border-left-color: var(--hud-teal);
		transform: translateX(2px);
		box-shadow: inset 2px 0 0 0 var(--hud-teal), var(--hud-surface-ghost);
	}

	.team-tournament-card--champion {
		border-left-color: #ffd166;
		background:
			linear-gradient(100deg, color-mix(in srgb, #ffd166 12%, var(--hud-panel)), transparent 58%),
			var(--hud-panel);
		box-shadow: 0 12px 36px rgb(0 0 0 / 16%), inset 0 0 40px color-mix(in srgb, #ffd166 4%, transparent);
	}

	.team-tournament-card--champion::before {
		width: 48%;
		background: linear-gradient(90deg, transparent, #ffd166);
	}

	.team-tournament-card--runner-up {
		border-left-color: #b8c7d9;
	}

	.team-tournament-card--top-four {
		border-left-color: #c98f65;
	}

	.team-result-badge {
		flex: 0 0 auto;
		border: 1px solid var(--hud-variant);
		background: var(--hud-inset);
		padding: 0.3rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--hud-muted);
		white-space: nowrap;
	}

	.team-result-badge--champion {
		border-color: color-mix(in srgb, #ffd166 55%, var(--hud-variant));
		color: #ffd166;
	}

	.team-result-badge--runner-up {
		border-color: color-mix(in srgb, #b8c7d9 55%, var(--hud-variant));
		color: #d6e0ec;
	}

	@keyframes team-pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.45; transform: scale(0.75); }
	}

	@media (min-width: 1024px) {
		.team-layout {
			grid-template-columns: minmax(19rem, 0.72fr) minmax(0, 1.28fr);
		}

		.team-profile-card {
			position: sticky;
			top: 1.5rem;
		}
	}

	@media (max-width: 640px) {
		.team-profile-card {
			padding: 1.2rem;
		}

		.team-roster__slot {
			grid-template-columns: 1.6rem 2.25rem 1fr;
		}

		.team-role {
			grid-column: 3;
			justify-self: start;
		}

		.team-tournament-card__footer {
			flex-wrap: wrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.live-pulse {
			animation: none;
		}
	}
</style>

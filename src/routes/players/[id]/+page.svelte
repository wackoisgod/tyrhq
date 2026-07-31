<script lang="ts">
	let { data } = $props();

	const player = $derived(data.player);
	const seriesPlayed = $derived(player.stats.seriesWins + player.stats.seriesLosses);
	const gamesPlayed = $derived(player.stats.gameWins + player.stats.gameLosses);
	const seriesWinRate = $derived(
		seriesPlayed > 0 ? Math.round((player.stats.seriesWins / seriesPlayed) * 100) : 0
	);
	const gameWinRate = $derived(
		gamesPlayed > 0 ? Math.round((player.stats.gameWins / gamesPlayed) * 100) : 0
	);

	function initials(name: string) {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || 'TY';
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function statusLabel(status: string) {
		if (status === 'in_progress') return 'Live';
		if (status === 'open') return 'Registered';
		if (status === 'completed') return 'Completed';
		if (status === 'cancelled') return 'Cancelled';
		return status;
	}
</script>

<svelte:head>
	<title>Tyr HQ | {player.displayName} Competitive Profile</title>
	<meta
		name="description"
		content="Tournament history, placements, and competitive record for {player.displayName}."
	/>
</svelte:head>

<section class="player-page mx-auto max-w-6xl px-4 py-8 md:px-6">
	<nav class="player-breadcrumb" aria-label="Breadcrumb">
		<a href="/tournaments">Tournaments</a>
		<span aria-hidden="true">//</span>
		<span>Competitive pilot</span>
	</nav>

	<header class="player-hero">
		<div class="player-hero__scan" aria-hidden="true"></div>
		<div class="player-avatar" aria-hidden="true">
			<span>{initials(player.displayName)}</span>
			<i></i>
		</div>
		<div class="player-identity">
			<p class="hud-eyebrow">Competitive pilot profile</p>
			<h1 class="hud-headline">{player.displayName}</h1>
			<div class="player-team-line">
				{#if player.currentTeams.length > 0}
					{#each player.currentTeams as team}
						<a href="/teams/{team.slug}" class="player-team-chip">
							<span>{initials(team.name)}</span>
							<strong>{team.name}</strong>
							<small>{team.role}</small>
						</a>
					{/each}
				{:else}
					<span class="player-unaffiliated">No active team</span>
				{/if}
			</div>
		</div>
		<div class="player-rank-mark" aria-hidden="true">
			<span>{String(player.stats.tournamentsPlayed).padStart(2, '0')}</span>
			<small>Events</small>
		</div>
	</header>

	<div class="player-stat-grid">
		<article class="player-stat">
			<span class="hud-label">Tournaments played</span>
			<strong class="hud-numeric">{player.stats.tournamentsPlayed}</strong>
			<small>Events with a completed team series</small>
		</article>
		<article class="player-stat">
			<span class="hud-label">Series record</span>
			{#if seriesPlayed > 0}
				<strong class="hud-numeric">{player.stats.seriesWins}<i>–</i>{player.stats.seriesLosses}</strong>
				<small>{seriesWinRate}% team win rate · {player.stats.seriesAppearances} series</small>
			{:else}
				<strong class="hud-numeric">—</strong>
				<small>No completed team series</small>
			{/if}
		</article>
		<article class="player-stat player-stat--games">
			<span class="hud-label">Game record</span>
			{#if gamesPlayed > 0}
				<strong class="hud-numeric">{player.stats.gameWins}<i>–</i>{player.stats.gameLosses}</strong>
				<small>{gameWinRate}% win rate · {player.stats.gameAppearances} game{player.stats.gameAppearances === 1 ? '' : 's'} played</small>
			{:else}
				<strong class="hud-numeric">—</strong>
				<small>{player.stats.gameAppearances > 0 ? 'Game results not recorded' : 'No recorded game appearances'}</small>
			{/if}
		</article>
		<article class="player-stat player-stat--honors">
			<span class="hud-label">Tournament honors</span>
			<div class="player-honor-values">
				<strong class="hud-numeric">{player.stats.titles}<small>Titles</small></strong>
				<strong class="hud-numeric">{player.stats.topFourFinishes}<small>Top 4</small></strong>
			</div>
		</article>
	</div>

	<section class="player-history">
		<div class="player-section-heading">
			<div>
				<p class="hud-eyebrow">Competition archive</p>
				<h2>Tournament history</h2>
			</div>
			<span>{player.history.length} roster appearance{player.history.length === 1 ? '' : 's'}</span>
		</div>

		<div class="player-history-list">
			{#each player.history as entry, index}
				<article
					class="history-card"
					class:history-card--champion={entry.finish.tier === 'champion'}
					class:history-card--podium={entry.finish.tier === 'runner_up' || entry.finish.tier === 'semifinalist'}
					class:history-card--active={entry.finish.tier === 'active'}
				>
					<div class="history-order hud-numeric">{String(index + 1).padStart(2, '0')}</div>
					<div class="history-logo" class:history-logo--image={Boolean(entry.tournament.logoUrl)}>
						{#if entry.tournament.logoUrl}
							<img src={entry.tournament.logoUrl} alt="" />
						{:else}
							<span>{initials(entry.tournament.name)}</span>
						{/if}
					</div>
					<div class="history-main">
						<div class="history-title-row">
							<div>
								<p class="hud-eyebrow">{formatDate(entry.tournament.startsAt)}</p>
								<h3><a href="/tournaments/{entry.tournament.slug}">{entry.tournament.name}</a></h3>
							</div>
							<span class="history-status" class:history-status--live={entry.tournament.status === 'in_progress'}>
								{statusLabel(entry.tournament.status)}
							</span>
						</div>
						<div class="history-meta">
							<span>Represented</span>
							{#if entry.team.isDisabled}
								<strong>{entry.team.name}</strong>
							{:else}
								<a href="/teams/{entry.team.slug}">{entry.team.name}</a>
							{/if}
							{#if entry.seed}<span>Seed #{entry.seed}</span>{/if}
							{#if entry.source === 'free_agent'}<span class="history-pickup">Free-agent pickup</span>{/if}
						</div>
					</div>
					<div class="history-result">
						<span class="history-placement">{entry.finish.placementLabel ?? entry.finish.label}</span>
						<strong>{entry.finish.label}</strong>
					</div>
					<div class="history-records">
						<div>
							<span>Series</span>
							<strong class="hud-numeric">
								{entry.record.seriesWins + entry.record.seriesLosses > 0 ? `${entry.record.seriesWins}–${entry.record.seriesLosses}` : '—'}
							</strong>
						</div>
						<div>
							<span>Games</span>
							<strong class="hud-numeric">
								{entry.record.gameWins + entry.record.gameLosses > 0 ? `${entry.record.gameWins}–${entry.record.gameLosses}` : '—'}
							</strong>
						</div>
					</div>
					<a class="history-link" href="/tournaments/{entry.tournament.slug}" aria-label="View {entry.tournament.name}">
						<span>View event</span><b aria-hidden="true">→</b>
					</a>
				</article>
			{:else}
				<div class="player-empty">
					<span class="hud-eyebrow">No results logged</span>
					<h3>Competitive history starts here.</h3>
					<p>This pilot has not appeared on a published tournament roster yet.</p>
				</div>
			{/each}
		</div>
	</section>

	<p class="player-record-note">
		Series results and tournament placements credit the full registered roster. Game results count only recorded games
		where this pilot appears in the lineup. Tied semifinal finishes are shown as 3rd–4th.
	</p>
</section>

<style>
	.player-page {
		position: relative;
	}

	.player-breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1rem;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--hud-dim);
	}

	.player-breadcrumb a { color: var(--hud-teal); }
	.player-breadcrumb a:hover { color: var(--hud-text); }

	.player-hero {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.5rem;
		min-height: 13.5rem;
		overflow: hidden;
		padding: 2rem;
		background:
			linear-gradient(105deg, rgba(26, 34, 51, 0.98), rgba(12, 17, 27, 0.94)),
			repeating-linear-gradient(90deg, transparent 0 70px, rgba(153, 247, 255, 0.025) 71px 72px);
		box-shadow:
			inset 4px 0 0 var(--hud-teal),
			inset 0 0 0 1px rgba(160, 170, 217, 0.16),
			0 26px 60px rgba(0, 0, 0, 0.3);
	}

	.player-hero::after {
		content: '';
		position: absolute;
		right: -8rem;
		top: -14rem;
		width: 34rem;
		height: 34rem;
		border: 1px solid rgba(153, 247, 255, 0.1);
		transform: rotate(35deg);
		box-shadow: 0 0 60px rgba(153, 247, 255, 0.06);
	}

	.player-hero__scan {
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(153, 247, 255, 0.07), transparent);
		transform: translateX(-100%);
		animation: profile-scan 8s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes profile-scan {
		0%, 60% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	.player-avatar {
		position: relative;
		z-index: 1;
		display: grid;
		width: 7.5rem;
		height: 7.5rem;
		place-items: center;
		background: linear-gradient(145deg, rgba(42, 51, 77, 0.95), rgba(10, 15, 24, 0.98));
		clip-path: polygon(0 0, 84% 0, 100% 16%, 100% 100%, 16% 100%, 0 84%);
		box-shadow: inset 0 0 0 1px rgba(153, 247, 255, 0.4);
	}

	.player-avatar::before {
		content: '';
		position: absolute;
		inset: 0.45rem;
		border: 1px solid rgba(160, 170, 217, 0.2);
		clip-path: inherit;
	}

	.player-avatar span {
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		color: var(--hud-teal);
		text-shadow: 0 0 22px rgba(153, 247, 255, 0.25);
	}

	.player-avatar i {
		position: absolute;
		right: 0.8rem;
		bottom: 0.8rem;
		width: 0.55rem;
		height: 0.55rem;
		background: #50f2ba;
		box-shadow: 0 0 12px #50f2ba;
	}

	.player-identity { position: relative; z-index: 1; min-width: 0; }
	.player-identity h1 { margin-top: 0.65rem; font-size: clamp(2rem, 5vw, 4.3rem); color: var(--hud-text); }

	.player-team-line { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.4rem; }
	.player-team-chip {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0 0.6rem;
		align-items: center;
		padding: 0.55rem 0.8rem;
		background: rgba(10, 15, 24, 0.72);
		box-shadow: inset 3px 0 0 var(--hud-ally), inset 0 0 0 1px rgba(160, 170, 217, 0.15);
		color: var(--hud-text);
	}
	.player-team-chip > span { grid-row: 1 / 3; font-family: var(--font-mono); color: var(--hud-teal); }
	.player-team-chip strong { font-size: 0.83rem; }
	.player-team-chip small { font-family: var(--font-mono); font-size: 0.55rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--hud-dim); }
	.player-team-chip:hover { background: rgba(42, 51, 77, 0.9); }
	.player-unaffiliated { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-muted); }

	.player-rank-mark { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-end; padding-right: 1rem; }
	.player-rank-mark span { font-family: var(--font-display); font-size: clamp(3.5rem, 8vw, 7rem); font-weight: 900; line-height: 0.8; color: rgba(231, 231, 255, 0.09); }
	.player-rank-mark small { margin-top: 0.8rem; font-family: var(--font-mono); font-size: 0.62rem; font-weight: 800; letter-spacing: 0.28em; text-transform: uppercase; color: var(--hud-teal); }

	.player-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; margin-top: 0.8rem; }
	.player-stat { position: relative; min-height: 8.5rem; padding: 1.25rem; background: linear-gradient(180deg, rgba(26, 34, 51, 0.94), rgba(13, 17, 26, 0.98)); box-shadow: inset 0 0 0 1px rgba(160, 170, 217, 0.12); }
	.player-stat::before { content: ''; position: absolute; left: 0; top: 0; width: 2px; height: 45%; background: var(--hud-purple-300, var(--hud-ally)); }
	.player-stat > strong { display: block; margin-top: 0.75rem; font-size: 2rem; color: var(--hud-text); }
	.player-stat > strong i { padding: 0 0.22rem; font-style: normal; color: var(--hud-dim); }
	.player-stat > small { display: block; margin-top: 0.35rem; font-family: var(--font-mono); font-size: 0.64rem; color: var(--hud-muted); }
	.player-stat--games::before { background: var(--hud-teal); }
	.player-stat--honors::before { height: 100%; background: #ffd166; box-shadow: 0 0 16px rgba(255, 209, 102, 0.35); }
	.player-honor-values { display: flex; gap: 1.5rem; margin-top: 0.75rem; }
	.player-honor-values strong { font-size: 1.7rem; color: #ffd166; }
	.player-honor-values small { display: block; margin-top: 0.15rem; font-family: var(--font-mono); font-size: 0.55rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-muted); }

	.player-history { margin-top: 3rem; }
	.player-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
	.player-section-heading h2 { margin-top: 0.35rem; font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 2.3rem); font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: var(--hud-text); }
	.player-section-heading > span { font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-dim); }
	.player-history-list { display: flex; flex-direction: column; gap: 0.65rem; }

	.history-card { position: relative; display: grid; grid-template-columns: 2.5rem 4rem minmax(13rem, 1fr) minmax(8rem, auto) auto auto; gap: 1rem; align-items: center; min-height: 7.5rem; padding: 1rem 1.1rem; overflow: hidden; background: linear-gradient(90deg, rgba(21, 28, 43, 0.98), rgba(12, 17, 27, 0.98)); box-shadow: inset 3px 0 0 rgba(160, 170, 217, 0.35), inset 0 0 0 1px rgba(160, 170, 217, 0.11); }
	.history-card::after { content: ''; position: absolute; right: 0; top: 0; width: 5rem; height: 1px; background: rgba(153, 247, 255, 0.25); }
	.history-card--champion { box-shadow: inset 3px 0 0 #ffd166, inset 0 0 0 1px rgba(255, 209, 102, 0.18), 0 10px 35px rgba(255, 209, 102, 0.06); }
	.history-card--podium { box-shadow: inset 3px 0 0 var(--hud-purple-300, #a0aad9), inset 0 0 0 1px rgba(160, 170, 217, 0.16); }
	.history-card--active { box-shadow: inset 3px 0 0 var(--hud-teal), inset 0 0 0 1px rgba(153, 247, 255, 0.15), 0 10px 35px rgba(153, 247, 255, 0.05); }
	.history-order { font-size: 0.65rem; color: var(--hud-dim); }
	.history-logo { display: grid; width: 3.7rem; height: 3.7rem; place-items: center; overflow: hidden; background: rgba(10, 15, 24, 0.8); box-shadow: inset 0 0 0 1px rgba(160, 170, 217, 0.18); font-family: var(--font-display); font-weight: 900; color: var(--hud-teal); }
	.history-logo img { width: 100%; height: 100%; object-fit: cover; }
	.history-main { min-width: 0; }
	.history-title-row { display: flex; align-items: start; justify-content: space-between; gap: 0.75rem; }
	.history-title-row h3 { margin-top: 0.3rem; overflow: hidden; font-size: 1rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; color: var(--hud-text); }
	.history-title-row h3 a:hover { color: var(--hud-teal); }
	.history-status { padding: 0.3rem 0.45rem; border: 1px solid rgba(160, 170, 217, 0.22); font-family: var(--font-mono); font-size: 0.52rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; color: var(--hud-muted); }
	.history-status--live { border-color: rgba(153, 247, 255, 0.35); color: var(--hud-teal); }
	.history-meta { display: flex; flex-wrap: wrap; gap: 0.45rem 0.8rem; margin-top: 0.65rem; font-size: 0.7rem; color: var(--hud-dim); }
	.history-meta a, .history-meta strong { color: var(--hud-text); }
	.history-meta a:hover { color: var(--hud-teal); }
	.history-pickup { color: var(--hud-teal) !important; }
	.history-result { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem; }
	.history-placement { font-family: var(--font-display); font-size: 1.1rem; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: var(--hud-text); }
	.history-card--champion .history-placement { color: #ffd166; text-shadow: 0 0 16px rgba(255, 209, 102, 0.2); }
	.history-result strong { font-family: var(--font-mono); font-size: 0.55rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-dim); }
	.history-records { display: flex; gap: 1rem; }
	.history-records > div { min-width: 3rem; }
	.history-records span { display: block; font-family: var(--font-mono); font-size: 0.5rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--hud-dim); }
	.history-records strong { display: block; margin-top: 0.25rem; color: var(--hud-text); }
	.history-link { display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-mono); font-size: 0.55rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-teal); }
	.history-link b { font-size: 1rem; transition: transform 150ms ease; }
	.history-link:hover b { transform: translateX(0.25rem); }
	.player-empty { padding: 3rem; text-align: center; background: rgba(21, 28, 43, 0.75); box-shadow: inset 0 0 0 1px rgba(160, 170, 217, 0.12); }
	.player-empty h3 { margin-top: 0.75rem; font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; text-transform: uppercase; color: var(--hud-text); }
	.player-empty p { margin-top: 0.5rem; color: var(--hud-muted); }
	.player-record-note { max-width: 54rem; margin-top: 1.25rem; font-size: 0.72rem; line-height: 1.65; color: var(--hud-dim); }

	@media (max-width: 900px) {
		.player-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.history-card { grid-template-columns: 2rem 3.7rem minmax(0, 1fr) auto; }
		.history-result, .history-records { grid-column: 3; }
		.history-link { grid-column: 4; grid-row: 1 / 4; }
		.history-order { grid-row: 1 / 4; }
		.history-logo { grid-row: 1 / 4; }
	}

	@media (max-width: 640px) {
		.player-hero { grid-template-columns: auto minmax(0, 1fr); gap: 1rem; padding: 1.3rem; }
		.player-avatar { width: 5rem; height: 5rem; }
		.player-avatar span { font-size: 1.5rem; }
		.player-rank-mark { display: none; }
		.player-stat-grid { grid-template-columns: 1fr; }
		.player-section-heading { align-items: start; flex-direction: column; }
		.history-card { grid-template-columns: 3.5rem minmax(0, 1fr); padding: 1rem; }
		.history-order { display: none; }
		.history-logo { grid-row: 1; }
		.history-main { grid-column: 2; }
		.history-title-row { align-items: start; flex-direction: column; }
		.history-title-row h3 { white-space: normal; }
		.history-result, .history-records, .history-link { grid-column: 2; grid-row: auto; }
		.history-link { margin-top: 0.35rem; }
	}

	@media (prefers-reduced-motion: reduce) {
		.player-hero__scan { animation: none; }
	}
</style>

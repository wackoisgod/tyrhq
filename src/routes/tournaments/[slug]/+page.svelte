<script lang="ts">
	import { onMount } from 'svelte';

	let { data, form } = $props();

	const registeredTeamIds = $derived(new Set(data.tournament.registrations.map((r) => r.teamId)));
	const rounds = $derived(groupMatches(data.tournament.matches));
	const rankedResults = $derived(getRankedResults());
	let showSettings = $state(false);
	let showBracketTools = $state(false);
	let activeTab = $state<'overview' | 'teams' | 'bracket'>('overview');
	let startsAtLocal = $state('');
	let registrationClosesAtLocal = $state('');
	const registrationClosed = $derived(isRegistrationClosed());

	function groupMatches(matches: typeof data.tournament.matches) {
		const grouped: Record<string, typeof data.tournament.matches> = {};
		for (const match of matches) {
			const key = String(match.round);
			grouped[key] = [...(grouped[key] ?? []), match];
		}
		return grouped;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}

	function datetimeInputValue(iso: string | null) {
		if (!iso) return '';
		const date = new Date(iso);
		const offset = date.getTimezoneOffset();
		const local = new Date(date.getTime() - offset * 60_000);
		return local.toISOString().slice(0, 16);
	}

	function isoFromLocal(value: string) {
		if (!value) return '';
		const time = new Date(value).getTime();
		return Number.isFinite(time) ? new Date(time).toISOString() : '';
	}

	onMount(() => {
		startsAtLocal = datetimeInputValue(data.tournament.startsAt);
		registrationClosesAtLocal = datetimeInputValue(data.tournament.registrationClosesAt);
	});

	function isRegistrationClosed() {
		return Boolean(
			data.tournament.registrationClosesAt &&
				new Date(data.tournament.registrationClosesAt).getTime() <= Date.now()
		);
	}

	function registrationLabel() {
		if (data.tournament.status === 'cancelled') return 'Cancelled';
		if (data.tournament.status === 'completed') return 'Completed';
		if (data.tournament.status === 'in_progress') return 'In progress';
		if (data.tournament.registrationMode === 'manual_bracket') return 'Invite bracket';
		if (!data.tournament.registrationClosesAt) return 'Registration open';
		return registrationClosed ? 'Registration closed' : 'Registration open';
	}

	function registrationMeta() {
		if (data.tournament.registrationMode === 'manual_bracket') {
			return 'Teams are seeded by the organizer';
		}
		if (!data.tournament.registrationClosesAt) return 'No registration close time set';
		const closeDate = formatDate(data.tournament.registrationClosesAt);
		return registrationClosed ? `Registration closed ${closeDate}` : `Registration closes ${closeDate}`;
	}

	function teamSizeLabel() {
		const subs = data.tournament.substituteCount;
		return `8v8${subs > 0 ? ` + ${subs} sub${subs === 1 ? '' : 's'}` : ''}`;
	}

	function getRankedResults() {
		const stats = new Map<string, { team: NonNullable<(typeof data.tournament.registrations)[number]['team']>; wins: number; losses: number }>();
		for (const registration of data.tournament.registrations) {
			if (!registration.team) continue;
			stats.set(registration.team.id, { team: registration.team, wins: 0, losses: 0 });
		}
		for (const match of data.tournament.matches) {
			if (match.status !== 'completed' || !match.winnerTeamId) continue;
			if (match.teamA?.id) {
				const row = stats.get(match.teamA.id);
				if (row) match.winnerTeamId === match.teamA.id ? row.wins++ : row.losses++;
			}
			if (match.teamB?.id) {
				const row = stats.get(match.teamB.id);
				if (row) match.winnerTeamId === match.teamB.id ? row.wins++ : row.losses++;
			}
		}
		return [...stats.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.team.name.localeCompare(b.team.name));
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.tournament.name}</title>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<div
		class="tournament-hero"
		style={data.tournament.logoUrl ? `--tournament-image: url('${data.tournament.logoUrl}')` : ''}
	>
		<div class="tournament-hero__inner">
			<div class="min-w-0 flex-1">
				<p class="hud-eyebrow">{registrationLabel()}</p>
				<h1 class="mt-3 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)] md:text-5xl">
					{data.tournament.name}
				</h1>
				<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--hud-text)]">
					<span>{formatDate(data.tournament.startsAt)}</span>
					<span class="text-[var(--hud-dim)]">Organizer: {data.tournament.organizerName || 'Unknown'}</span>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					<span class="tournament-pill">{data.tournament.status}</span>
					<span class="tournament-pill">Team Size {teamSizeLabel()}</span>
				</div>
				<div class="mt-5 flex flex-wrap gap-2">
					{#if data.tournament.rulesUrl}
						<a href={data.tournament.rulesUrl} target="_blank" rel="noreferrer" class="hud-cta-outline px-4 py-2 text-xs">Rules</a>
					{/if}
					{#if data.tournament.discordUrl}
						<a href={data.tournament.discordUrl} target="_blank" rel="noreferrer" class="hud-cta-outline px-4 py-2 text-xs">Discord</a>
					{/if}
					{#if data.tournament.canManage}
						<button
							type="button"
							class="hud-cta-outline px-4 py-2 text-xs"
							aria-expanded={showSettings}
							onclick={() => (showSettings = !showSettings)}
						>
							{showSettings ? 'Close Settings' : 'Tournament Settings'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="tournament-tabs" role="tablist" aria-label="Tournament sections">
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'overview'}
			onclick={() => (activeTab = 'overview')}
		>
			Overview
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'teams'}
			onclick={() => (activeTab = 'teams')}
		>
			Teams
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'bracket'}
			onclick={() => (activeTab = 'bracket')}
		>
			Bracket
		</button>
	</div>

	{#if form?.error}
		<div class="mt-6 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">
			{form.error}
		</div>
	{:else if form?.success}
		<div class="mt-6 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]">
			{form.success}
		</div>
	{/if}

	{#if data.tournament.canManage && showSettings}
		<section class="mt-6 hud-panel p-6">
			<form method="POST" action="?/update" class="grid gap-4 lg:grid-cols-2">
				<input type="hidden" name="tournamentId" value={data.tournament.id} />
				<div class="lg:col-span-2">
					<p class="hud-label">Edit Tournament</p>
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Name</span>
					<input name="name" required maxlength="120" value={data.tournament.name} class="hud-input px-3 py-2" />
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Summary</span>
					<textarea name="summary" maxlength="500" rows="3" class="hud-input px-3 py-2">{data.tournament.summary ?? ''}</textarea>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Start Time</span>
					<input type="hidden" name="startsAt" value={isoFromLocal(startsAtLocal)} />
					<input bind:value={startsAtLocal} type="datetime-local" required class="hud-input px-3 py-2" />
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Registration Closes</span>
					<input type="hidden" name="registrationClosesAt" value={isoFromLocal(registrationClosesAtLocal)} />
					<input bind:value={registrationClosesAtLocal} type="datetime-local" class="hud-input px-3 py-2" />
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Status</span>
					<select name="status" class="hud-input px-3 py-2" value={data.tournament.status}>
						<option value="draft">Draft</option>
						<option value="open">Open</option>
						<option value="in_progress">In progress</option>
						<option value="completed">Completed</option>
						<option value="cancelled">Cancelled</option>
					</select>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Mode</span>
					<select name="registrationMode" class="hud-input px-3 py-2" value={data.tournament.registrationMode}>
						<option value="open">Open</option>
						<option value="manual_bracket">Manual</option>
					</select>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Team Size</span>
						<input type="text" value="8v8" readonly class="hud-input px-3 py-2" />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Subs</span>
						<input name="substituteCount" type="number" min="0" max="16" value={data.tournament.substituteCount} class="hud-input px-3 py-2" />
					</label>
				</div>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Rules URL</span>
					<input name="rulesUrl" type="url" maxlength="500" value={data.tournament.rulesUrl ?? ''} class="hud-input px-3 py-2" />
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Discord URL</span>
					<input name="discordUrl" type="url" maxlength="500" value={data.tournament.discordUrl ?? ''} class="hud-input px-3 py-2" />
				</label>
				<div class="flex flex-wrap gap-3 lg:col-span-2">
					<button class="hud-cta px-4 py-3">Save Tournament</button>
				</div>
			</form>

			<form method="POST" action="?/logo" enctype="multipart/form-data" class="mt-6 flex flex-col gap-3 border-t border-[var(--hud-variant)] pt-5">
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Tournament Logo</span>
					<input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hud-input px-3 py-2" />
				</label>
				<button class="hud-cta-outline px-4 py-2 text-xs">Upload Logo</button>
			</form>
		</section>
	{/if}

	<div class="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
		<div class="flex flex-col gap-8">
			{#if activeTab === 'overview'}
				<section>
					<h2 class="text-2xl font-semibold text-[var(--hud-text)]">Overview</h2>
					<dl class="overview-facts mt-3">
						<div class="overview-fact">
							<dt>Team Size</dt>
							<dd>{teamSizeLabel()}</dd>
						</div>
						<div class="overview-fact">
							<dt>Format</dt>
							<dd>{data.tournament.registrationMode === 'manual_bracket' ? 'Premade bracket' : 'Open registration'}</dd>
						</div>
						<div class="overview-fact">
							<dt>Starts</dt>
							<dd>{formatDate(data.tournament.startsAt)}</dd>
						</div>
						<div class="overview-fact">
							<dt>Status</dt>
							<dd>{data.tournament.status}</dd>
						</div>
						<div class="overview-fact overview-fact--wide">
							<dt>Registration</dt>
							<dd>
								<span>{registrationMeta()}</span>
							</dd>
						</div>
					</dl>
					{#if data.tournament.summary}
						<div class="mt-6 text-sm leading-7 text-[var(--hud-muted)]">{data.tournament.summary}</div>
					{/if}

				</section>
			{/if}

			{#if activeTab === 'teams'}
				<section>
					<h2 class="text-2xl font-semibold text-[var(--hud-text)]">Teams</h2>
					<div class="mt-4 grid gap-3 sm:grid-cols-2">
						{#each data.tournament.registrations as registration}
							{#if registration.team}
								<a href="/teams/{registration.team.slug}" class="rounded-sm bg-[var(--hud-panel)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]" style="box-shadow: var(--hud-surface-ghost);">
									<p class="font-semibold uppercase text-[var(--hud-text)]">
										{#if registration.seed}<span class="text-[var(--hud-teal)]">#{registration.seed}</span> {/if}{registration.team.name}
									</p>
									<p class="mt-1 text-xs text-[var(--hud-muted)]">
										{registration.team.record.wins}-{registration.team.record.losses}
									</p>
								</a>
							{/if}
						{:else}
							<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No teams registered yet.</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if activeTab === 'bracket'}
				<section>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h2 class="text-2xl font-semibold text-[var(--hud-text)]">Bracket</h2>
						{#if data.tournament.canManage}
							<button
								type="button"
								class="hud-cta-outline px-4 py-2 text-xs"
								aria-expanded={showBracketTools}
								onclick={() => (showBracketTools = !showBracketTools)}
							>
								{showBracketTools ? 'Close Tools' : 'Bracket Tools'}
							</button>
						{/if}
					</div>
					{#if data.tournament.canManage && showBracketTools}
						<div class="mt-4 hud-panel p-5">
							<form method="POST" action="?/seed" class="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
								<input type="hidden" name="tournamentId" value={data.tournament.id} />
								<select name="teamId" class="hud-input px-3 py-2">
									{#each data.allTeams as team}
										<option value={team.id}>{team.name}</option>
									{/each}
								</select>
								<input name="seed" type="number" min="1" value="1" class="hud-input px-3 py-2" />
								<button class="hud-cta-outline px-4 py-2 text-xs">Save Seed</button>
							</form>
							<form method="POST" action="?/bracket" class="mt-3">
								<input type="hidden" name="tournamentId" value={data.tournament.id} />
								<button class="hud-cta px-4 py-3">Generate Bracket</button>
							</form>
						</div>
					{/if}
					<div class="mt-4 grid gap-3 xl:grid-cols-2">
						{#each Object.entries(rounds) as [round, matches]}
							<div class="rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
								<h3 class="text-sm font-semibold uppercase text-[var(--hud-text)]">Round {round}</h3>
								<div class="mt-3 grid gap-3">
									{#each matches ?? [] as match}
										<div class="rounded-sm bg-[var(--hud-inset)] p-3">
											<p class="text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">Match {match.matchNumber} · {match.status}</p>
											<div class="mt-2 grid gap-1 text-sm text-[var(--hud-text)]">
												<p>{match.teamA?.name ?? 'TBD'} <span class="hud-numeric text-[var(--hud-muted)]">{match.scoreA}</span></p>
												<p>{match.teamB?.name ?? 'TBD'} <span class="hud-numeric text-[var(--hud-muted)]">{match.scoreB}</span></p>
											</div>
											{#if match.winner}
												<p class="mt-2 text-xs text-[var(--hud-teal)]">Winner: {match.winner.name}</p>
											{/if}
											{#if data.tournament.canManage && showBracketTools && match.teamA && match.teamB}
												<form method="POST" action="?/result" class="mt-3 grid gap-2 sm:grid-cols-[70px_70px_1fr_auto]">
													<input type="hidden" name="matchId" value={match.id} />
													<input name="scoreA" type="number" min="0" value={match.scoreA} class="hud-input px-2 py-1 text-xs" />
													<input name="scoreB" type="number" min="0" value={match.scoreB} class="hud-input px-2 py-1 text-xs" />
													<select name="winnerTeamId" class="hud-input px-2 py-1 text-xs">
														<option value={match.teamA.id}>{match.teamA.name}</option>
														<option value={match.teamB.id}>{match.teamB.name}</option>
													</select>
													<button class="hud-cta-outline px-3 py-1 text-xs">Save</button>
												</form>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{:else}
							<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No bracket has been generated yet.</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>

		<aside class="space-y-6">
			<section class="hud-panel p-5">
				<h2 class="text-xl font-semibold text-[var(--hud-text)]">Registration</h2>
				<p class="mt-2 text-sm font-semibold text-[var(--hud-text)]">{registrationLabel()}</p>
				<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{registrationMeta()}</p>
				{#if data.tournament.registrationMode === 'open' && data.tournament.status === 'open' && !registrationClosed}
					<div class="mt-5">
						{#if !data.userId}
							<a href={data.loginHref} class="inline-block hud-cta px-4 py-3">Sign In To Register</a>
						{:else if data.captainTeams.length === 0}
							<a href="/teams" class="inline-block hud-cta px-4 py-3">Create A Team</a>
						{:else}
							<form method="POST" action="?/register" class="flex flex-col gap-3">
								<input type="hidden" name="tournamentId" value={data.tournament.id} />
								<select name="teamId" class="hud-input px-3 py-2">
									{#each data.captainTeams as team}
										<option value={team.id} disabled={registeredTeamIds.has(team.id)}>{team.name}{registeredTeamIds.has(team.id) ? ' (registered)' : ''}</option>
									{/each}
								</select>
								<button class="hud-cta px-4 py-3">Register</button>
							</form>
						{/if}
					</div>
				{:else if data.tournament.registrationMode === 'open' && registrationClosed}
					<div class="mt-5 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">Registration is closed.</div>
				{/if}
			</section>

			<section class="hud-panel p-5">
				<h2 class="text-xl font-semibold text-[var(--hud-text)]">Teams</h2>
				<div class="mt-4 grid grid-cols-3 gap-3 text-center">
					<div>
						<p class="hud-label">Registered</p>
						<p class="mt-2 hud-numeric text-2xl text-[var(--hud-text)]">{data.tournament.registrations.length}</p>
					</div>
					<div>
						<p class="hud-label">Size</p>
						<p class="mt-2 hud-numeric text-2xl text-[var(--hud-text)]">{data.tournament.teamSize}v{data.tournament.teamSize}</p>
					</div>
					<div>
						<p class="hud-label">Subs</p>
						<p class="mt-2 hud-numeric text-2xl text-[var(--hud-text)]">+{data.tournament.substituteCount}</p>
					</div>
				</div>
				<div class="mt-4 flex flex-wrap items-center gap-2">
					{#each data.tournament.registrations.slice(0, 8) as registration}
						{#if registration.team}
							<a href="/teams/{registration.team.slug}" class="team-dot" title={registration.team.name}>
								{#if registration.team.logoUrl}
									<img src={registration.team.logoUrl} alt="" />
								{:else}
									<span>{registration.team.name.slice(0, 2)}</span>
								{/if}
							</a>
						{/if}
					{/each}
				</div>
				<button type="button" class="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]" onclick={() => (activeTab = 'teams')}>
					View teams
				</button>
			</section>

			<section class="hud-panel overflow-hidden">
				<div class="flex items-center justify-between gap-3 p-5 pb-3">
					<h2 class="text-xl font-semibold text-[var(--hud-text)]">Results</h2>
					<button type="button" class="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]" onclick={() => (activeTab = 'bracket')}>
						View bracket
					</button>
				</div>
				{#each rankedResults.slice(0, 3) as result, index}
					<a href="/teams/{result.team.slug}" class="result-row">
						<span class="hud-numeric text-[var(--hud-text)]">{index + 1}</span>
						<span class="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--hud-text)]">{result.team.name}</span>
						<span class="hud-numeric text-xs text-[var(--hud-muted)]">{result.wins}-{result.losses}</span>
					</a>
				{:else}
					<p class="p-5 pt-2 text-sm text-[var(--hud-muted)]">No completed matches yet.</p>
				{/each}
			</section>
		</aside>
	</div>
</section>

<style>
	.tournament-hero {
		min-height: 26rem;
		display: flex;
		align-items: end;
		background:
			linear-gradient(180deg, rgba(5, 10, 20, 0.08) 0%, rgba(5, 10, 20, 0.38) 42%, rgba(5, 10, 20, 0.97) 100%),
			var(--tournament-image, linear-gradient(135deg, rgba(117, 241, 244, 0.16), rgba(116, 95, 255, 0.12))),
			var(--hud-panel);
		background-position: center;
		background-size: cover;
		border-bottom: 1px solid var(--hud-variant);
		box-shadow: var(--hud-surface-ghost);
	}

	.tournament-hero__inner {
		width: 100%;
		padding: 12rem 2rem 2rem;
	}

	.tournament-pill {
		border-radius: 2px;
		background: color-mix(in srgb, var(--hud-teal) 18%, var(--hud-panel));
		color: var(--hud-text);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 0.22rem 0.55rem;
		text-transform: uppercase;
	}

	.tournament-tabs {
		display: flex;
		gap: 1.75rem;
		border-bottom: 1px solid var(--hud-variant);
		padding-top: 1.25rem;
	}

	.tournament-tabs button {
		border-bottom: 2px solid transparent;
		color: var(--hud-muted);
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.75rem 0;
		background: transparent;
		cursor: pointer;
	}

	.tournament-tabs button:hover,
	.tournament-tabs button[aria-selected='true'] {
		border-color: var(--hud-teal);
		color: var(--hud-text);
	}

	.overview-facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border: 1px solid color-mix(in srgb, var(--hud-variant) 78%, transparent);
		border-radius: 2px;
		background: color-mix(in srgb, var(--hud-panel) 78%, transparent);
		box-shadow: var(--hud-surface-ghost);
	}

	.overview-fact {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--hud-variant) 64%, transparent);
		padding: 0.75rem 0.95rem;
	}

	.overview-fact:nth-child(odd) {
		border-right: 1px solid color-mix(in srgb, var(--hud-variant) 64%, transparent);
	}

	.overview-fact dt {
		color: var(--hud-teal);
		font-family: var(--font-display);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.overview-fact dd {
		min-width: 0;
		text-align: right;
		color: var(--hud-text);
		font-size: 0.92rem;
		font-weight: 700;
	}

	.overview-fact--wide {
		grid-column: 1 / -1;
		border-bottom: 0;
		border-right: 0;
	}

	.overview-fact--wide dd {
		display: flex;
		flex-wrap: wrap;
		justify-content: end;
		gap: 0.35rem 1rem;
	}

	@media (max-width: 720px) {
		.overview-facts {
			grid-template-columns: 1fr;
		}

		.overview-fact,
		.overview-fact:nth-child(odd) {
			border-right: 0;
		}
	}

	.team-dot {
		display: grid;
		place-items: center;
		width: 2.4rem;
		aspect-ratio: 1;
		overflow: hidden;
		border: 1px solid var(--hud-variant);
		border-radius: 999px;
		background: var(--hud-inset);
		color: var(--hud-teal);
		font-family: var(--font-display);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.team-dot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.result-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border-bottom: 1px solid color-mix(in srgb, var(--hud-variant) 70%, transparent);
		padding: 0.85rem 1rem;
	}

	.result-row:hover {
		background: color-mix(in srgb, var(--hud-teal) 8%, transparent);
	}

	@media (max-width: 720px) {
		.tournament-hero__inner {
			padding-top: 9rem;
		}
	}
</style>

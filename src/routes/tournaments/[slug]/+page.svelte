<script lang="ts">
	import { onMount } from 'svelte';

	import { getSnakeFirstRoundSeeds } from '$lib/tournaments/bracket';

	let { data, form } = $props();

	const registeredTeamIds = $derived(new Set(data.tournament.registrations.map((r) => r.teamId)));
	const availableCaptainTeams = $derived(
		data.captainTeams.filter((team) => !registeredTeamIds.has(team.id))
	);
	const rounds = $derived(groupMatches(data.tournament.matches));
	const bracketRounds = $derived(
		Object.entries(rounds).sort(([left], [right]) => Number(left) - Number(right))
	);
	const finalRoundNumber = $derived(Number(bracketRounds.at(-1)?.[0] ?? 1));
	const bracketGridRows = $derived(Math.max(2, (bracketRounds[0]?.[1].length ?? 1) * 2));
	const bracketMinimumWidth = $derived(
		Math.max(1, bracketRounds.length) * 264 + Math.max(0, bracketRounds.length - 1) * 48
	);
	const seedsByTeamId = $derived(
		new Map(data.tournament.registrations.map((registration) => [registration.teamId, registration.seed]))
	);
	const rankedResults = $derived(getRankedResults());
	let showSettings = $state(false);
	let showBracketTools = $state(false);
	let activeTab = $state<'overview' | 'teams' | 'free-agents' | 'loadouts' | 'bracket'>('overview');
	let startsAtLocal = $state('');
	let registrationClosesAtLocal = $state('');
	let reopenClosesAtLocal = $state('');
	const registrationClosed = $derived(isRegistrationClosed());
	let seedOrder = $state(initialSeedOrder());
	let draggedSeedIndex = $state<number | null>(null);
	let pastedSeedOrder = $state('');
	let seedingNotice = $state('');
	const bracketLocked = $derived(
		data.tournament.matches.length > 0 ||
		data.tournament.status === 'in_progress' ||
		data.tournament.status === 'completed' ||
		data.tournament.status === 'cancelled'
	);
	const availableTeams = $derived(
		data.allTeams.filter((team) => !seedOrder.some((entry) => entry.team.id === team.id))
	);
	const seedingChanged = $derived(seedOrder.some((entry, index) => entry.savedSeed !== index + 1));
	const firstRoundPreview = $derived(getFirstRoundPreview());
	const pendingPickupTeamIds = $derived(
		new Set(data.freeAgentContext.viewer?.pendingTeamIds ?? [])
	);
	const recruitingTeamIds = $derived(new Set(data.freeAgentContext.recruitingTeamIds));
	const registrationOpen = $derived(
		data.tournament.registrationMode === 'open' &&
		data.tournament.status === 'open' &&
		!registrationClosed &&
		!bracketLocked &&
		new Date(data.tournament.startsAt).getTime() > Date.now()
	);
	const canReopenRegistration = $derived(
		data.tournament.canManage &&
		data.tournament.registrationMode === 'open' &&
		!bracketLocked &&
		data.tournament.status !== 'cancelled' &&
		new Date(data.tournament.startsAt).getTime() > Date.now() &&
		(data.tournament.status !== 'open' || registrationClosed)
	);

	function groupMatches(matches: typeof data.tournament.matches) {
		const grouped: Record<string, typeof data.tournament.matches> = {};
		for (const match of matches) {
			const key = String(match.round);
			grouped[key] = [...(grouped[key] ?? []), match];
		}
		return grouped;
	}

	function bracketRoundTitle(round: number) {
		const roundsFromFinal = finalRoundNumber - round;
		if (roundsFromFinal === 0) return 'Final';
		if (roundsFromFinal === 1) return 'Semifinals';
		if (roundsFromFinal === 2) return 'Quarterfinals';
		return `Round ${round}`;
	}

	function bracketRoundSpan(round: number) {
		return Math.min(bracketGridRows, 2 ** round);
	}

	function teamSeed(teamId: string | null | undefined) {
		if (!teamId) return null;
		return seedsByTeamId.get(teamId) ?? null;
	}

	function matchStatusLabel(status: string) {
		return status.replaceAll('_', ' ');
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

	function visibilityLabel(visibility: string) {
		if (visibility === 'immediate') return 'Public now';
		if (visibility === 'after_tournament') return 'After tournament';
		return 'After completed match';
	}

	function initialSeedOrder() {
		return data.tournament.registrations.flatMap((registration) =>
			registration.team ? [{ team: registration.team, savedSeed: registration.seed }] : []
		);
	}

	function moveSeed(from: number, to: number) {
		if (from === to || from < 0 || to < 0 || from >= seedOrder.length || to >= seedOrder.length) return;
		const next = [...seedOrder];
		const [entry] = next.splice(from, 1);
		if (!entry) return;
		next.splice(to, 0, entry);
		seedOrder = next;
		seedingNotice = '';
	}

	function handleDragStart(event: DragEvent, index: number) {
		draggedSeedIndex = index;
		event.dataTransfer?.setData('text/plain', String(index));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		const transferredIndex = Number(event.dataTransfer?.getData('text/plain'));
		const from = draggedSeedIndex ?? (Number.isInteger(transferredIndex) ? transferredIndex : -1);
		moveSeed(from, index);
		draggedSeedIndex = null;
	}

	function shuffleSeeds() {
		const next = [...seedOrder];
		for (let index = next.length - 1; index > 0; index--) {
			const swapIndex = Math.floor(Math.random() * (index + 1));
			[next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
		}
		seedOrder = next;
		seedingNotice = 'Order shuffled. Save the ranking to keep it.';
	}

	function normalizePastedTeam(value: string) {
		return value
			.replace(/^\s*#?\d+\s*[.)\-:,\t]\s*/, '')
			.trim()
			.toLocaleLowerCase();
	}

	function applyPastedRanking() {
		const entries = pastedSeedOrder
			.split(/\r?\n/)
			.map(normalizePastedTeam)
			.filter(Boolean);
		if (entries.length !== seedOrder.length) {
			seedingNotice = `Paste exactly ${seedOrder.length} team name${seedOrder.length === 1 ? '' : 's'}, one per line.`;
			return;
		}

		const byName = new Map<string, (typeof seedOrder)[number]>();
		for (const entry of seedOrder) {
			byName.set(entry.team.name.trim().toLocaleLowerCase(), entry);
			byName.set(entry.team.slug.trim().toLocaleLowerCase(), entry);
		}
		const ranked = entries.map((name) => byName.get(name));
		if (ranked.some((entry) => !entry) || new Set(ranked.map((entry) => entry?.team.id)).size !== seedOrder.length) {
			seedingNotice = 'Every line must match a different registered team name or slug.';
			return;
		}
		seedOrder = ranked.filter((entry): entry is (typeof seedOrder)[number] => Boolean(entry));
		seedingNotice = 'Pasted ranking applied. Save it to keep the order.';
	}

	function getFirstRoundPreview() {
		if (seedOrder.length < 2) return [];
		return getSnakeFirstRoundSeeds(seedOrder.length).map(([seedA, seedB], index) => ({
			matchNumber: index + 1,
			seedA,
			seedB,
			teamA: seedA ? seedOrder[seedA - 1]?.team ?? null : null,
			teamB: seedB ? seedOrder[seedB - 1]?.team ?? null : null
		}));
	}

	onMount(() => {
		activeTab = data.initialTab;
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
	<div class="tournament-hero">
		{#if data.tournament.logoUrl}
			<img class="tournament-hero__image" src={data.tournament.logoUrl} alt="" />
		{/if}
		<div class="tournament-hero__inner">
			<div class="min-w-0 flex-1">
				<p class="hud-eyebrow">{registrationLabel()}</p>
				<h1 class="mt-3 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)] md:text-5xl">
					{data.tournament.name}
				</h1>
				<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--hud-text)]">
					<span>{formatDate(data.tournament.startsAt)}</span>
					<span class="text-[var(--hud-dim)]">Organizer: <a href="/players/{data.tournament.organizerId}" class="text-[var(--hud-teal)] hover:text-[var(--hud-text)]">{data.tournament.organizerName || 'Unknown'}</a></span>
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
			aria-selected={activeTab === 'free-agents'}
			onclick={() => (activeTab = 'free-agents')}
		>
			Free Agents
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'loadouts'}
			onclick={() => (activeTab = 'loadouts')}
		>
			Loadouts
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

	<div
		class="tournament-content mt-8"
		class:tournament-content--bracket={activeTab === 'bracket'}
	>
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

			{#if activeTab === 'free-agents'}
				<section>
					<div class="flex flex-wrap items-end justify-between gap-3">
						<div>
							<p class="hud-eyebrow">Tournament recruiting</p>
							<h2 class="mt-2 text-2xl font-semibold text-[var(--hud-text)]">Free Agents</h2>
							<p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
								Players opt in, request a recruiting team, and join only after its captain approves. Tournament pickups do not change permanent team membership.
							</p>
						</div>
						<span class="tournament-pill">{data.freeAgentContext.freeAgents.length} available</span>
					</div>

					{#if data.tournament.registrationMode !== 'open'}
						<div class="mt-5 hud-panel p-5 text-sm text-[var(--hud-muted)]">Free-agent registration is only available for open-registration tournaments.</div>
					{:else}
						<div class="mt-6 grid gap-5 xl:grid-cols-2">
							<section class="hud-panel p-5">
								<h3 class="text-lg font-semibold text-[var(--hud-text)]">Your Free-Agent Profile</h3>
								{#if !data.userId}
									<p class="mt-2 text-sm text-[var(--hud-muted)]">Sign in to enter the pool or request a team.</p>
									<a href={data.loginHref} class="mt-4 inline-block hud-cta px-4 py-3">Sign In</a>
								{:else if data.freeAgentContext.viewer?.hasPermanentTeam}
									<p class="mt-2 text-sm text-[var(--hud-muted)]">You are already on a permanent team, so you cannot enter this tournament's free-agent pool.</p>
								{:else if data.freeAgentContext.viewer?.freeAgentStatus === 'placed'}
									<p class="mt-2 text-sm font-semibold text-[var(--hud-teal)]">You have been placed on {data.freeAgentContext.viewer.rosterTeamName || 'a team'}'s tournament roster.</p>
								{:else if data.freeAgentContext.viewer?.freeAgentStatus === 'available'}
									<p class="mt-2 text-sm text-[var(--hud-muted)]">You are visible to captains and can request any recruiting team below.</p>
									<form method="POST" action="?/freeAgent" class="mt-4 grid gap-3">
										<input type="hidden" name="tournamentId" value={data.tournament.id} />
										<label class="grid gap-1.5">
											<span class="hud-label">Preferred role</span>
											<input name="preferredRole" maxlength="80" value={data.freeAgentContext.viewer.preferredRole} class="hud-input px-3 py-2" placeholder="Optional" />
										</label>
										<label class="grid gap-1.5">
											<span class="hud-label">Note</span>
											<textarea name="note" maxlength="280" rows="3" class="hud-input px-3 py-2" placeholder="Availability, experience, or anything captains should know">{data.freeAgentContext.viewer.note}</textarea>
										</label>
										<div class="flex flex-wrap gap-2">
											<button class="hud-cta px-4 py-3" disabled={!registrationOpen}>Update Profile</button>
										</div>
									</form>
									<form method="POST" action="?/withdrawFreeAgent" class="mt-2">
										<input type="hidden" name="tournamentId" value={data.tournament.id} />
										<button class="hud-cta-outline px-3 py-2 text-xs" disabled={!registrationOpen}>Leave Pool</button>
									</form>
								{:else if registrationOpen}
									<p class="mt-2 text-sm text-[var(--hud-muted)]">Not on a team? List yourself for this tournament and request a recruiting roster.</p>
									<form method="POST" action="?/freeAgent" class="mt-4 grid gap-3">
										<input type="hidden" name="tournamentId" value={data.tournament.id} />
										<label class="grid gap-1.5">
											<span class="hud-label">Preferred role</span>
											<input name="preferredRole" maxlength="80" class="hud-input px-3 py-2" placeholder="Optional" />
										</label>
										<label class="grid gap-1.5">
											<span class="hud-label">Note</span>
											<textarea name="note" maxlength="280" rows="3" class="hud-input px-3 py-2" placeholder="Availability, experience, or anything captains should know"></textarea>
										</label>
										<button class="hud-cta px-4 py-3">Register As Free Agent</button>
									</form>
								{:else}
									<p class="mt-2 text-sm text-[var(--hud-muted)]">Free-agent registration is closed.</p>
								{/if}
							</section>

							{#if data.captainTeams.length > 0}
								<section class="hud-panel p-5">
									<h3 class="text-lg font-semibold text-[var(--hud-text)]">Recruit For Your Team</h3>
									<p class="mt-2 text-sm text-[var(--hud-muted)]">Enabling recruitment snapshots the current team into a tournament-only roster.</p>
									<div class="mt-4 grid gap-3">
										{#each data.captainTeams as team}
											{@const isRecruiting = recruitingTeamIds.has(team.id)}
											{@const rosterCount = data.freeAgentContext.rosterCounts[team.id] ?? 0}
											<div class="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-[var(--hud-inset)] p-3">
												<div>
													<p class="font-semibold text-[var(--hud-text)]">{team.name}</p>
													<p class="mt-1 text-xs text-[var(--hud-muted)]">Tournament roster: {rosterCount}/{data.tournament.maxTeamMembers}</p>
												</div>
												<form method="POST" action="?/recruiting">
													<input type="hidden" name="tournamentId" value={data.tournament.id} />
													<input type="hidden" name="teamId" value={team.id} />
													<input type="hidden" name="isRecruiting" value={isRecruiting ? 'false' : 'true'} />
													<button class={isRecruiting ? 'hud-cta-outline px-3 py-2 text-xs' : 'hud-cta px-3 py-2 text-xs'} disabled={!registrationOpen}>{isRecruiting ? 'Pause Recruiting' : 'Recruit Players'}</button>
												</form>
											</div>
										{/each}
									</div>
								</section>
							{/if}
						</div>

						<div class="mt-6 grid gap-5 xl:grid-cols-2">
							<section class="hud-panel p-5">
								<h3 class="text-lg font-semibold text-[var(--hud-text)]">Recruiting Teams</h3>
								<div class="mt-4 grid gap-3">
									{#each data.freeAgentContext.recruitingTeams as team}
										<div class="rounded-sm bg-[var(--hud-inset)] p-4">
											<div class="flex items-center justify-between gap-3">
												<a href="/teams/{team.slug}" class="font-semibold text-[var(--hud-text)] hover:text-[var(--hud-teal)]">{team.name}</a>
												<span class="hud-numeric text-xs text-[var(--hud-muted)]">{team.rosterCount}/{data.tournament.maxTeamMembers}</span>
											</div>
											<p class="mt-1 text-xs text-[var(--hud-muted)]">{team.isRegistered ? 'Registered team' : 'Building roster'}</p>
											{#if registrationOpen && data.freeAgentContext.viewer?.freeAgentStatus === 'available'}
												{#if pendingPickupTeamIds.has(team.teamId)}
													<form method="POST" action="?/cancelPickup" class="mt-3">
														<input type="hidden" name="tournamentId" value={data.tournament.id} />
														<input type="hidden" name="teamId" value={team.teamId} />
														<button class="hud-cta-outline px-3 py-2 text-xs">Cancel Request</button>
													</form>
												{:else}
													<form method="POST" action="?/requestPickup" class="mt-3">
														<input type="hidden" name="tournamentId" value={data.tournament.id} />
														<input type="hidden" name="teamId" value={team.teamId} />
														<button class="hud-cta px-3 py-2 text-xs">Request This Team</button>
													</form>
												{/if}
											{/if}
										</div>
									{:else}
										<p class="text-sm text-[var(--hud-muted)]">No teams are recruiting yet.</p>
									{/each}
								</div>
							</section>

							<section class="hud-panel p-5">
								<h3 class="text-lg font-semibold text-[var(--hud-text)]">Available Players</h3>
								<div class="mt-4 grid gap-3">
									{#each data.freeAgentContext.freeAgents as freeAgent}
										<div class="rounded-sm bg-[var(--hud-inset)] p-4">
											<a href="/players/{freeAgent.userId}" class="font-semibold text-[var(--hud-text)] hover:text-[var(--hud-teal)]">{freeAgent.displayName}</a>
											{#if freeAgent.preferredRole}<p class="mt-1 text-xs text-[var(--hud-teal)]">{freeAgent.preferredRole}</p>{/if}
											{#if freeAgent.note}<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{freeAgent.note}</p>{/if}
										</div>
									{:else}
										<p class="text-sm text-[var(--hud-muted)]">No players are currently listed.</p>
									{/each}
								</div>
							</section>
						</div>

						{#if data.freeAgentContext.captainRequests.length > 0}
							<section class="mt-6 hud-panel p-5">
								<h3 class="text-lg font-semibold text-[var(--hud-text)]">Pickup Requests</h3>
								<div class="mt-4 grid gap-3 md:grid-cols-2">
									{#each data.freeAgentContext.captainRequests as request}
										<div class="rounded-sm bg-[var(--hud-inset)] p-4">
											<a href="/players/{request.userId}" class="font-semibold text-[var(--hud-text)] hover:text-[var(--hud-teal)]">{request.displayName}</a>
											{#if request.preferredRole}<p class="mt-1 text-xs text-[var(--hud-teal)]">{request.preferredRole}</p>{/if}
											{#if request.note}<p class="mt-2 text-sm text-[var(--hud-muted)]">{request.note}</p>{/if}
											<form method="POST" action="?/reviewPickup" class="mt-3 flex gap-2">
												<input type="hidden" name="tournamentId" value={data.tournament.id} />
												<input type="hidden" name="teamId" value={request.teamId} />
												<input type="hidden" name="freeAgentId" value={request.userId} />
												<button name="decision" value="approve" class="hud-cta px-3 py-2 text-xs" disabled={!registrationOpen}>Approve</button>
												<button name="decision" value="reject" class="hud-cta-outline px-3 py-2 text-xs" disabled={!registrationOpen}>Reject</button>
											</form>
										</div>
									{/each}
								</div>
							</section>
						{/if}
					{/if}
				</section>
			{/if}

			{#if activeTab === 'loadouts'}
				<section>
					<div class="flex flex-wrap items-end justify-between gap-3">
						<div>
							<p class="hud-eyebrow">Tournament archive</p>
							<h2 class="mt-2 text-2xl font-semibold text-[var(--hud-text)]">Player Loadouts</h2>
							<p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
								Roster members can submit public builds and control when spectators see them. Builds used in a completed series become part of its game history.
							</p>
						</div>
						<span class="tournament-pill">{data.buildContext.submissions.length} submitted</span>
					</div>

					{#if data.buildContext.canSubmit}
						<section class="mt-5 hud-panel p-5">
							<h3 class="text-lg font-semibold text-[var(--hud-text)]">Submit Your Build</h3>
							<p class="mt-2 text-sm text-[var(--hud-muted)]">Only public builds are eligible. A snapshot is saved with the tournament submission.</p>
							{#if data.buildContext.availableBuilds.length > 0}
								<form method="POST" action="?/submitBuild" class="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)_auto]">
									<input type="hidden" name="tournamentId" value={data.tournament.id} />
									<label class="grid gap-1.5">
										<span class="hud-label">Public build</span>
										<select name="buildId" class="hud-input px-3 py-2" required>
											{#each data.buildContext.availableBuilds as build}
												<option value={build.id}>{build.title} · {build.vehicleName}</option>
											{/each}
										</select>
									</label>
									<label class="grid gap-1.5">
										<span class="hud-label">Reveal</span>
										<select name="visibility" class="hud-input px-3 py-2">
											<option value="after_match">After its match</option>
											<option value="after_tournament">After tournament</option>
											<option value="immediate">Immediately</option>
										</select>
									</label>
									<button class="hud-cta self-end px-4 py-3">Submit</button>
								</form>
							{:else}
								<p class="mt-4 text-sm text-[var(--hud-muted)]">You do not have any public builds yet.</p>
								<a href="/tools/builds" class="mt-3 inline-block hud-cta-outline px-4 py-2 text-xs">Create Or Publish A Build</a>
							{/if}
						</section>
					{:else if !data.userId}
						<div class="mt-5 hud-panel p-5 text-sm text-[var(--hud-muted)]">
							<a href={data.loginHref} class="font-semibold text-[var(--hud-teal)]">Sign in</a> to submit a build if you are on a tournament roster.
						</div>
					{/if}

					<div class="mt-6 grid gap-3 md:grid-cols-2">
						{#each data.buildContext.submissions as submission}
							<article class="hud-panel p-5">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<a href="/players/{submission.userId}" class="hud-eyebrow hover:text-[var(--hud-teal)]">{submission.displayName}</a>
										<h3 class="mt-2 truncate text-lg font-semibold text-[var(--hud-text)]">{submission.buildTitle}</h3>
										<p class="mt-1 text-sm text-[var(--hud-muted)]">{submission.vehicleName}</p>
									</div>
									<span class="tournament-pill">{visibilityLabel(submission.visibility)}</span>
								</div>
								<div class="mt-4 flex flex-wrap gap-2">
									{#if submission.canOpen && (submission.isPubliclyVisible || submission.isOwner || data.tournament.canManage)}
										<a href="/builds/{submission.buildSlug}" class="hud-cta-outline px-3 py-2 text-xs">View Build</a>
									{/if}
									{#if submission.isOwner}
										<form method="POST" action="?/removeBuild">
											<input type="hidden" name="tournamentId" value={data.tournament.id} />
											<input type="hidden" name="submissionId" value={submission.id} />
											<button class="hud-cta-outline px-3 py-2 text-xs">Remove</button>
										</form>
									{/if}
								</div>
							</article>
						{:else}
							<div class="hud-panel p-6 text-sm text-[var(--hud-muted)] md:col-span-2">No tournament builds are visible yet.</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if activeTab === 'bracket'}
				<section>
					<div class="flex flex-wrap items-end justify-between gap-3">
						<div>
							<p class="hud-eyebrow">Single elimination</p>
							<h2 class="mt-2 text-2xl font-semibold text-[var(--hud-text)]">Tournament Bracket</h2>
							<p class="mt-1 text-sm text-[var(--hud-muted)]">
								{data.tournament.registrations.length} teams · {bracketRounds.length} rounds
							</p>
						</div>
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
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<p class="hud-eyebrow">Organizer seeding</p>
									<h3 class="mt-1 text-lg font-semibold text-[var(--hud-text)]">Ranked team list</h3>
									<p class="mt-1 max-w-2xl text-sm text-[var(--hud-muted)]">
										The ranking is the source of truth. Bracket placement automatically follows the standard snake format.
									</p>
								</div>
								<span class="tournament-pill">{seedOrder.length} team{seedOrder.length === 1 ? '' : 's'}</span>
							</div>

							{#if bracketLocked}
								<div class="mt-4 rounded-sm border border-[var(--hud-border)] bg-[var(--hud-inset)] p-4">
									<p class="text-sm font-semibold text-[var(--hud-text)]">Seeds locked</p>
									<p class="mt-1 text-sm text-[var(--hud-muted)]">The bracket has been generated, so its ranked list can no longer be edited.</p>
								</div>
							{:else}
								{#if availableTeams.length > 0}
									<p class="mt-5 text-xs leading-5 text-[#ffd166]">Force registration bypasses captain approval and normal tournament-roster size limits.</p>
									<form method="POST" action="?/addTeam" class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]" onsubmit={(event) => {
										if (!confirm('Force register this team and bypass roster-size validation?')) event.preventDefault();
									}}>
										<input type="hidden" name="tournamentId" value={data.tournament.id} />
										<label class="sr-only" for="add-tournament-team">Force register team</label>
										<select id="add-tournament-team" name="teamId" class="hud-input px-3 py-2">
											{#each availableTeams as team}
												<option value={team.id}>{team.name}</option>
											{/each}
										</select>
										<button class="hud-cta-outline px-4 py-2 text-xs">Force Register</button>
									</form>
								{/if}

								{#if seedOrder.length > 0}
									<div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
										<div>
											<div class="flex flex-wrap items-center justify-between gap-2">
												<p class="text-xs uppercase tracking-[0.16em] text-[var(--hud-dim)]">Drag teams or use the arrows</p>
												<button type="button" class="hud-cta-outline px-3 py-2 text-xs" onclick={shuffleSeeds} disabled={seedOrder.length < 2}>Shuffle</button>
											</div>
											<ol class="mt-3 grid gap-2">
												{#each seedOrder as entry, index (entry.team.id)}
													<li
														draggable="true"
														class="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-sm bg-[var(--hud-inset)] p-3"
														ondragstart={(event) => handleDragStart(event, index)}
														ondragover={(event) => event.preventDefault()}
														ondrop={(event) => handleDrop(event, index)}
														ondragend={() => (draggedSeedIndex = null)}
													>
														<span class="hud-numeric text-lg font-semibold text-[var(--hud-teal)]">#{index + 1}</span>
														<a href="/teams/{entry.team.slug}" class="truncate font-semibold text-[var(--hud-text)] hover:text-[var(--hud-teal)]">{entry.team.name}</a>
														<div class="flex items-center gap-1">
															<button type="button" class="hud-cta-outline px-2 py-1 text-xs" aria-label="Move {entry.team.name} up" disabled={index === 0} onclick={() => moveSeed(index, index - 1)}>↑</button>
															<button type="button" class="hud-cta-outline px-2 py-1 text-xs" aria-label="Move {entry.team.name} down" disabled={index === seedOrder.length - 1} onclick={() => moveSeed(index, index + 1)}>↓</button>
															<form method="POST" action="?/removeTeam">
																<input type="hidden" name="tournamentId" value={data.tournament.id} />
																<input type="hidden" name="teamId" value={entry.team.id} />
																<button class="hud-cta-outline px-2 py-1 text-xs" aria-label="Remove {entry.team.name} from tournament">×</button>
															</form>
														</div>
													</li>
												{/each}
											</ol>

											<form method="POST" action="?/seeds" class="mt-3">
												<input type="hidden" name="tournamentId" value={data.tournament.id} />
												<input type="hidden" name="teamIds" value={JSON.stringify(seedOrder.map((entry) => entry.team.id))} />
												<button class="hud-cta px-4 py-3" disabled={!seedingChanged}>Save Ranking</button>
											</form>

											<div class="mt-5">
												<label for="paste-seed-order" class="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-dim)]">Paste ranked list</label>
												<textarea id="paste-seed-order" bind:value={pastedSeedOrder} rows="4" class="hud-input mt-2 w-full px-3 py-2 text-sm" placeholder="1. First Team&#10;2. Second Team"></textarea>
												<button type="button" class="hud-cta-outline mt-2 px-3 py-2 text-xs" onclick={applyPastedRanking}>Apply Pasted List</button>
												{#if seedingNotice}<p class="mt-2 text-xs text-[var(--hud-muted)]">{seedingNotice}</p>{/if}
											</div>
										</div>

										<div>
											<p class="text-xs uppercase tracking-[0.16em] text-[var(--hud-dim)]">First-round preview</p>
											<div class="mt-3 grid gap-2">
												{#each firstRoundPreview as preview}
													<div class="rounded-sm bg-[var(--hud-inset)] p-3 text-sm">
														<p class="text-[10px] uppercase tracking-[0.16em] text-[var(--hud-dim)]">Match {preview.matchNumber}</p>
														<p class="mt-1 font-semibold text-[var(--hud-text)]">#{preview.seedA} {preview.teamA?.name}</p>
														<p class="font-semibold text-[var(--hud-text)]">
															{#if preview.seedB}#{preview.seedB} {preview.teamB?.name}{:else}<span class="text-[var(--hud-muted)]">Bye</span>{/if}
														</p>
													</div>
												{/each}
											</div>

											{#if seedOrder.length >= 2 && !seedingChanged}
												<form method="POST" action="?/bracket" class="mt-4" onsubmit={(event) => {
													if (!confirm('Lock these seeds and generate the bracket?')) event.preventDefault();
												}}>
													<input type="hidden" name="tournamentId" value={data.tournament.id} />
													<button class="hud-cta w-full px-4 py-3">Lock Seeds &amp; Generate</button>
												</form>
											{:else if seedOrder.length >= 2}
												<p class="mt-4 text-xs text-[var(--hud-muted)]">Save the ranking before generating the bracket.</p>
											{/if}
										</div>
									</div>
								{:else}
									<p class="mt-5 text-sm text-[var(--hud-muted)]">Add or register teams to begin seeding.</p>
								{/if}
							{/if}
						</div>
					{/if}
					{#if bracketRounds.length > 0}
						<div class="bracket-viewport mt-5" role="region" aria-label="Tournament bracket; scroll horizontally to view later rounds">
							<div
								class="bracket-stage"
								class:bracket-stage--editing={data.tournament.canManage && showBracketTools}
								style={`--bracket-rounds: ${bracketRounds.length}; --bracket-rows: ${bracketGridRows}; min-width: ${bracketMinimumWidth}px;`}
							>
								{#each bracketRounds as [round, matches], roundIndex}
									{@const roundNumber = Number(round)}
									{@const roundSpan = bracketRoundSpan(roundNumber)}
									<section class="bracket-round" aria-labelledby="bracket-round-{round}">
										<div class="bracket-round__header">
											<p>Round {round}</p>
											<h3 id="bracket-round-{round}">{bracketRoundTitle(roundNumber)}</h3>
										</div>
										<div class="bracket-round__matches">
											{#each matches ?? [] as match, matchIndex}
												<div
													class="bracket-match-shell"
													class:bracket-match-shell--connected={roundIndex > 0}
													style={`grid-row: ${matchIndex * roundSpan + 1} / span ${roundSpan};`}
												>
													<article
														class="bracket-match-card"
														class:bracket-match-card--completed={match.status === 'completed'}
														class:bracket-match-card--has-previous={roundIndex > 0}
														class:bracket-match-card--has-next={roundIndex < bracketRounds.length - 1}
													>
														<header class="bracket-match-card__header">
															<span>Match {match.matchNumber}</span>
															<span class="bracket-match-card__status">{matchStatusLabel(match.status)}</span>
															<span>Bo{match.bestOf}</span>
														</header>
														<div class="bracket-teams">
															<div class="bracket-team" class:bracket-team--winner={match.winnerTeamId === match.teamA?.id}>
																<span class="bracket-team__seed">{teamSeed(match.teamA?.id) ? `#${teamSeed(match.teamA?.id)}` : '—'}</span>
																<span class="bracket-team__name">{match.teamA?.name ?? 'TBD'}</span>
																<strong>{match.scoreA}</strong>
															</div>
															<div class="bracket-team" class:bracket-team--winner={match.winnerTeamId === match.teamB?.id}>
																<span class="bracket-team__seed">{teamSeed(match.teamB?.id) ? `#${teamSeed(match.teamB?.id)}` : '—'}</span>
																<span class="bracket-team__name">{match.teamB?.name ?? 'TBD'}</span>
																<strong>{match.scoreB}</strong>
															</div>
														</div>
														<div class="bracket-match-card__footer">
															<a href="/tournaments/{data.tournament.slug}/matches/{match.id}">Series details</a>
															{#if match.winner}<span>{match.winner.name} advances</span>{/if}
														</div>
														{#if data.tournament.canManage && showBracketTools && match.teamA && match.teamB}
															<form method="POST" action="?/result" class="bracket-quick-result">
																<input type="hidden" name="matchId" value={match.id} />
																<input aria-label="{match.teamA.name} score" name="scoreA" type="number" min="0" max={Math.floor(match.bestOf / 2) + 1} value={match.scoreA} class="hud-input" />
																<input aria-label="{match.teamB.name} score" name="scoreB" type="number" min="0" max={Math.floor(match.bestOf / 2) + 1} value={match.scoreB} class="hud-input" />
																<select aria-label="Series winner" name="winnerTeamId" class="hud-input">
																	<option value={match.teamA.id}>{match.teamA.name}</option>
																	<option value={match.teamB.id}>{match.teamB.name}</option>
																</select>
																<button class="hud-cta-outline">Save</button>
															</form>
														{/if}
													</article>
												</div>
											{/each}
								</div>
									</section>
								{/each}
							</div>
						</div>
					{:else}
						<div class="mt-5 hud-panel p-6 text-sm text-[var(--hud-muted)]">No bracket has been generated yet.</div>
					{/if}
				</section>
			{/if}
		</div>

		<aside class="tournament-summary" class:tournament-summary--bracket={activeTab === 'bracket'}>
			<section class="hud-panel p-5">
				<h2 class="text-xl font-semibold text-[var(--hud-text)]">Registration</h2>
				<p class="mt-2 text-sm font-semibold text-[var(--hud-text)]">{registrationLabel()}</p>
				<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{registrationMeta()}</p>
				{#if registrationOpen}
					<div class="mt-5">
						{#if !data.userId}
							<a href={data.loginHref} class="inline-block hud-cta px-4 py-3">Sign In To Register</a>
						{:else if data.captainTeams.length === 0}
							<a href="/teams" class="inline-block hud-cta px-4 py-3">Create A Team</a>
						{:else if availableCaptainTeams.length > 0}
							<form method="POST" action="?/register" class="flex flex-col gap-3">
								<input type="hidden" name="tournamentId" value={data.tournament.id} />
								<select name="teamId" class="hud-input px-3 py-2">
									{#each availableCaptainTeams as team}
										<option value={team.id}>{team.name}</option>
									{/each}
								</select>
								<button class="hud-cta px-4 py-3">Register</button>
							</form>
						{:else}
							<p class="text-sm font-semibold text-[var(--hud-teal)]">Your team is registered.</p>
						{/if}
					</div>
				{:else if data.tournament.registrationMode === 'open' && !registrationOpen}
					<div class="mt-5 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">Registration is closed.</div>
				{/if}
				{#if canReopenRegistration}
					<form method="POST" action="?/reopenRegistration" class="mt-4 grid gap-3 border-t border-[var(--hud-variant)] pt-4">
						<input type="hidden" name="tournamentId" value={data.tournament.id} />
						<label class="grid gap-1.5">
							<span class="hud-label">New registration deadline</span>
							<input type="hidden" name="registrationClosesAt" value={isoFromLocal(reopenClosesAtLocal)} />
							<input bind:value={reopenClosesAtLocal} type="datetime-local" required class="hud-input px-3 py-2" />
						</label>
						<button class="hud-cta-outline px-3 py-2 text-xs">Reopen Registration</button>
					</form>
				{/if}
				{#if data.userId && !data.freeAgentContext.viewer?.hasPermanentTeam && data.freeAgentContext.viewer?.freeAgentStatus !== 'placed'}
					<button type="button" class="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]" onclick={() => (activeTab = 'free-agents')}>
						{data.freeAgentContext.viewer?.freeAgentStatus === 'available' ? 'Manage Free-Agent Profile' : 'Register As Free Agent'}
					</button>
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
		position: relative;
		isolation: isolate;
		min-height: 26rem;
		display: flex;
		align-items: end;
		background:
			linear-gradient(135deg, rgba(117, 241, 244, 0.16), rgba(116, 95, 255, 0.12)),
			var(--hud-panel);
		border-bottom: 1px solid var(--hud-variant);
		box-shadow: var(--hud-surface-ghost);
		overflow: hidden;
	}

	.tournament-hero__image {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tournament-hero::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(180deg, rgba(5, 10, 20, 0.08) 0%, rgba(5, 10, 20, 0.38) 42%, rgba(5, 10, 20, 0.97) 100%);
		pointer-events: none;
	}

	.tournament-hero__inner {
		position: relative;
		z-index: 2;
		width: 100%;
		padding: 12rem 2rem 2rem;
	}

	.tournament-content {
		display: grid;
		gap: 2rem;
	}

	.tournament-content > div {
		min-width: 0;
	}

	.tournament-summary {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.bracket-viewport {
		width: 100%;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		border: 1px solid color-mix(in srgb, var(--hud-variant) 72%, transparent);
		background:
			linear-gradient(90deg, color-mix(in srgb, var(--hud-panel) 66%, transparent), transparent 16%, transparent 84%, color-mix(in srgb, var(--hud-panel) 66%, transparent)),
			color-mix(in srgb, var(--hud-inset) 74%, transparent);
		box-shadow: var(--hud-surface-ghost);
		overscroll-behavior-inline: contain;
		scrollbar-color: var(--hud-teal) var(--hud-inset);
	}

	.bracket-stage {
		--bracket-column-gap: 3rem;
		--bracket-slot-height: 4.9rem;
		display: grid;
		grid-template-columns: repeat(var(--bracket-rounds), minmax(16.5rem, 1fr));
		column-gap: var(--bracket-column-gap);
		padding: 1.25rem;
	}

	.bracket-stage--editing {
		--bracket-slot-height: 7.25rem;
	}

	.bracket-round {
		display: grid;
		grid-template-rows: auto 1fr;
		min-width: 0;
	}

	.bracket-round__header {
		min-height: 3.75rem;
		border-bottom: 1px solid color-mix(in srgb, var(--hud-variant) 72%, transparent);
		padding: 0 0.25rem 0.8rem;
	}

	.bracket-round__header p {
		color: var(--hud-teal);
		font-family: var(--font-display);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.bracket-round__header h3 {
		margin-top: 0.2rem;
		color: var(--hud-text);
		font-size: 0.9rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.bracket-round__matches {
		display: grid;
		grid-template-rows: repeat(var(--bracket-rows), var(--bracket-slot-height));
	}

	.bracket-match-shell {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.bracket-match-shell--connected::before {
		content: '';
		position: absolute;
		left: calc(var(--bracket-column-gap) * -0.5);
		top: 25%;
		height: 50%;
		border-left: 1px solid color-mix(in srgb, var(--hud-teal) 46%, var(--hud-variant));
	}

	.bracket-match-card {
		position: relative;
		z-index: 1;
		width: 100%;
		min-width: 0;
		border: 1px solid color-mix(in srgb, var(--hud-variant) 80%, transparent);
		border-left: 2px solid var(--hud-variant);
		border-radius: 2px;
		background: color-mix(in srgb, var(--hud-panel) 96%, var(--hud-teal));
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
	}

	.bracket-match-card--completed {
		border-left-color: var(--hud-teal);
	}

	.bracket-match-card--has-previous::before,
	.bracket-match-card--has-next::after {
		content: '';
		position: absolute;
		top: 50%;
		width: calc(var(--bracket-column-gap) * 0.5);
		border-top: 1px solid color-mix(in srgb, var(--hud-teal) 46%, var(--hud-variant));
	}

	.bracket-match-card--has-previous::before {
		right: 100%;
	}

	.bracket-match-card--has-next::after {
		left: 100%;
	}

	.bracket-match-card__header,
	.bracket-match-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.65rem;
		color: var(--hud-dim);
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.bracket-match-card__status {
		flex: 1;
		text-align: center;
	}

	.bracket-teams {
		border-block: 1px solid color-mix(in srgb, var(--hud-variant) 64%, transparent);
	}

	.bracket-team {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.25rem;
		padding: 0.42rem 0.65rem;
		color: var(--hud-muted);
	}

	.bracket-team + .bracket-team {
		border-top: 1px solid color-mix(in srgb, var(--hud-variant) 52%, transparent);
	}

	.bracket-team--winner {
		background: color-mix(in srgb, var(--hud-teal) 10%, transparent);
		color: var(--hud-text);
	}

	.bracket-team__seed {
		color: var(--hud-dim);
		font-family: var(--font-display);
		font-size: 0.68rem;
	}

	.bracket-team__name {
		overflow: hidden;
		font-size: 0.82rem;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bracket-team strong {
		color: currentColor;
		font-family: var(--font-display);
		font-size: 1rem;
	}

	.bracket-match-card__footer a {
		color: var(--hud-teal);
	}

	.bracket-match-card__footer a:hover {
		color: var(--hud-text);
	}

	.bracket-match-card__footer span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bracket-quick-result {
		display: grid;
		grid-template-columns: 2.5rem 2.5rem minmax(0, 1fr) auto;
		gap: 0.35rem;
		border-top: 1px solid color-mix(in srgb, var(--hud-variant) 64%, transparent);
		padding: 0.55rem;
	}

	.bracket-quick-result :is(input, select, button) {
		min-width: 0;
		padding: 0.35rem 0.45rem;
		font-size: 0.65rem;
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
		max-width: 100%;
		overflow-x: auto;
		border-bottom: 1px solid var(--hud-variant);
		padding-top: 1.25rem;
		scrollbar-width: thin;
	}

	.tournament-tabs button {
		flex: 0 0 auto;
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

	@media (min-width: 1024px) {
		.tournament-content {
			grid-template-columns: minmax(0, 1fr) 22rem;
		}

		.tournament-content--bracket {
			grid-template-columns: minmax(0, 1fr);
		}

		.tournament-summary--bracket {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			align-items: start;
		}
	}

	@media (max-width: 720px) {
		.tournament-hero__inner {
			padding-top: 9rem;
		}

		.bracket-stage {
			--bracket-column-gap: 2.25rem;
			padding: 1rem;
		}
	}
</style>

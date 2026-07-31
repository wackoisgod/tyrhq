<script lang="ts">
	let { data, form } = $props();

	const mapsById = $derived(new Map(data.detail.maps.map((map) => [map.id, map])));
	const vehiclesById = $derived(new Map(data.detail.vehicles.map((vehicle) => [vehicle.id, vehicle])));
	const buildsById = $derived(new Map(data.detail.builds.submissions.map((build) => [build.id, build])));
	const gameNumbers = $derived(
		data.detail.canManage
			? Array.from({ length: data.detail.match.bestOf }, (_, index) => index + 1)
			: data.detail.games.map((game) => game.gameNumber)
	);

	function formatDate(iso: string | null) {
		if (!iso) return '';
		return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}

	function datetimeInputValue(iso: string | null) {
		if (!iso) return '';
		const date = new Date(iso);
		const offset = date.getTimezoneOffset();
		return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
	}

	function gameFor(gameNumber: number) {
		return data.detail.games.find((game) => game.gameNumber === gameNumber) ?? null;
	}

	function teamName(teamId: string | null | undefined) {
		const teamA = data.detail.match.teamA;
		const teamB = data.detail.match.teamB;
		if (teamA && teamId === teamA.id) return teamA.name;
		if (teamB && teamId === teamB.id) return teamB.name;
		return 'Not recorded';
	}

	function lineupFor(gameId: string, userId: string) {
		return data.detail.lineups.find((lineup) => lineup.gameId === gameId && lineup.userId === userId) ?? null;
	}

	function canEditPlayer(userId: string) {
		return data.detail.canManage || data.detail.viewerId === userId;
	}

	function submittedBuildsFor(userId: string) {
		return data.detail.builds.submissions.filter((build) => build.userId === userId);
	}

	function buildFor(submissionId: string | null) {
		return submissionId ? buildsById.get(submissionId) ?? null : null;
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.tournament.name} Match {data.detail.match.matchNumber}</title>
</svelte:head>

<section class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<a href="/tournaments/{data.tournament.slug}?tab=bracket" class="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)] hover:text-[var(--hud-text)]">
		← Back To Bracket
	</a>

	<header class="series-header mt-5">
		<div>
			<p class="hud-eyebrow">Round {data.detail.match.round} · Match {data.detail.match.matchNumber}</p>
			<h1 class="mt-3 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)] md:text-5xl">
				{data.detail.match.teamA?.name ?? 'TBD'} <span class="text-[var(--hud-dim)]">vs</span> {data.detail.match.teamB?.name ?? 'TBD'}
			</h1>
			<div class="mt-4 flex flex-wrap gap-2">
				<span class="series-pill">Best of {data.detail.match.bestOf}</span>
				<span class="series-pill">{data.detail.match.status}</span>
				{#if data.detail.match.scheduledAt}<span class="series-pill">{formatDate(data.detail.match.scheduledAt)}</span>{/if}
			</div>
		</div>
		<div class="series-score" aria-label="Series score">
			<div>
				<span>{data.detail.match.teamA?.name ?? 'TBD'}</span>
				<strong>{data.detail.match.scoreA}</strong>
			</div>
			<div>
				<span>{data.detail.match.teamB?.name ?? 'TBD'}</span>
				<strong>{data.detail.match.scoreB}</strong>
			</div>
		</div>
	</header>

	{#if data.detail.match.streamUrl || data.detail.match.notes}
		<div class="mt-4 flex flex-wrap items-start gap-4 hud-panel p-4">
			{#if data.detail.match.streamUrl}
				<a href={data.detail.match.streamUrl} target="_blank" rel="noreferrer" class="hud-cta-outline px-3 py-2 text-xs">Watch Stream</a>
			{/if}
			{#if data.detail.match.notes}<p class="text-sm leading-6 text-[var(--hud-muted)]">{data.detail.match.notes}</p>{/if}
		</div>
	{/if}

	{#if form?.error}
		<div class="mt-5 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">{form.error}</div>
	{:else if form?.success}
		<div class="mt-5 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]">{form.success}</div>
	{/if}

	{#if data.detail.canManage}
		<details class="mt-6 hud-panel p-5">
			<summary class="cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-[var(--hud-text)]">Organizer Series Settings</summary>
			<form method="POST" action="?/settings" class="mt-5 grid gap-4 md:grid-cols-2">
				<input type="hidden" name="matchId" value={data.detail.match.id} />
				<label class="grid gap-1.5">
					<span class="hud-label">Format</span>
					<select name="bestOf" class="hud-input px-3 py-2" value={String(data.detail.match.bestOf)}>
						<option value="1">Best of 1</option>
						<option value="3">Best of 3</option>
						<option value="5">Best of 5</option>
						<option value="7">Best of 7</option>
						<option value="9">Best of 9</option>
					</select>
				</label>
				<label class="grid gap-1.5">
					<span class="hud-label">Scheduled time</span>
					<input name="scheduledAt" type="datetime-local" value={datetimeInputValue(data.detail.match.scheduledAt)} class="hud-input px-3 py-2" />
				</label>
				<label class="grid gap-1.5">
					<span class="hud-label">Stream or event VOD</span>
					<input name="streamUrl" type="url" maxlength="500" value={data.detail.match.streamUrl ?? ''} class="hud-input px-3 py-2" />
				</label>
				<label class="grid gap-1.5 md:col-span-2">
					<span class="hud-label">Series notes</span>
					<textarea name="notes" maxlength="1000" rows="3" class="hud-input px-3 py-2">{data.detail.match.notes ?? ''}</textarea>
				</label>
				<button class="hud-cta w-fit px-4 py-3">Save Settings</button>
			</form>

			{#if data.detail.match.teamA && data.detail.match.teamB}
				<form method="POST" action="?/quickResult" class="mt-6 grid gap-3 border-t border-[var(--hud-variant)] pt-5 sm:grid-cols-[90px_90px_minmax(0,1fr)_auto]">
					<input type="hidden" name="matchId" value={data.detail.match.id} />
					<input name="scoreA" aria-label="{data.detail.match.teamA.name} score" type="number" min="0" max={Math.floor(data.detail.match.bestOf / 2) + 1} value={data.detail.match.scoreA} class="hud-input px-3 py-2" />
					<input name="scoreB" aria-label="{data.detail.match.teamB.name} score" type="number" min="0" max={Math.floor(data.detail.match.bestOf / 2) + 1} value={data.detail.match.scoreB} class="hud-input px-3 py-2" />
					<select name="winnerTeamId" aria-label="Series winner" class="hud-input px-3 py-2">
						<option value={data.detail.match.teamA.id}>{data.detail.match.teamA.name}</option>
						<option value={data.detail.match.teamB.id}>{data.detail.match.teamB.name}</option>
					</select>
					<button class="hud-cta-outline px-3 py-2 text-xs">Save Quick Result</button>
				</form>
			{/if}
		</details>
	{/if}

	<div class="mt-8 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="hud-eyebrow">Series breakdown</p>
			<h2 class="mt-2 text-2xl font-semibold text-[var(--hud-text)]">Games</h2>
		</div>
		{#if data.detail.viewerTeamId}
			<a href="/tournaments/{data.tournament.slug}?tab=loadouts" class="hud-cta-outline px-3 py-2 text-xs">Manage Tournament Builds</a>
		{/if}
	</div>

	<div class="mt-4 grid gap-5">
		{#each gameNumbers as gameNumber}
			{@const game = gameFor(gameNumber)}
			{@const map = game ? mapsById.get(game.mapId) : null}
			<article class="game-card">
				<div class="game-card__summary">
					{#if map}
						<img src="/images/maps/lobby/{map.id}.png" alt="" class="game-card__map" />
					{/if}
					<div class="game-card__scrim"></div>
					<div class="game-card__content">
						<p class="hud-eyebrow">Game {gameNumber}</p>
						<h3 class="mt-2 text-2xl font-semibold text-[var(--hud-text)]">{map?.name ?? 'Not recorded'}</h3>
						{#if game}
							<p class="mt-2 text-sm text-[var(--hud-muted)]">Picked by <strong class="text-[var(--hud-text)]">{teamName(game.pickedByTeamId)}</strong></p>
							<p class="mt-1 text-sm text-[var(--hud-muted)]">Winner <strong class="text-[var(--hud-teal)]">{teamName(game.winnerTeamId)}</strong></p>
							<div class="mt-3 flex flex-wrap gap-2">
								{#if map}<a href="/maps/{map.slug}" class="hud-cta-outline px-3 py-2 text-xs">View Map</a>{/if}
								{#if game.vodUrl}<a href={game.vodUrl} target="_blank" rel="noreferrer" class="hud-cta-outline px-3 py-2 text-xs">Watch Game</a>{/if}
							</div>
							{#if game.notes}<p class="mt-3 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">{game.notes}</p>{/if}
						{:else}
							<p class="mt-2 text-sm text-[var(--hud-muted)]">The organizer has not entered this game.</p>
						{/if}
					</div>
				</div>

				{#if data.detail.canManage && data.detail.match.teamA && data.detail.match.teamB}
					<form method="POST" action="?/game" class="grid gap-3 border-t border-[var(--hud-variant)] p-4 md:grid-cols-2 xl:grid-cols-4">
						<input type="hidden" name="matchId" value={data.detail.match.id} />
						<input type="hidden" name="gameNumber" value={gameNumber} />
						<label class="grid gap-1.5">
							<span class="hud-label">Map</span>
							<select name="mapId" class="hud-input px-3 py-2" required value={game?.mapId ?? ''}>
								<option value="" disabled>Select map</option>
								{#each data.detail.maps as option}<option value={option.id}>{option.name}</option>{/each}
							</select>
						</label>
						<label class="grid gap-1.5">
							<span class="hud-label">Picked by</span>
							<select name="pickedByTeamId" class="hud-input px-3 py-2" value={game?.pickedByTeamId ?? data.detail.match.teamA.id}>
								<option value={data.detail.match.teamA.id}>{data.detail.match.teamA.name}</option>
								<option value={data.detail.match.teamB.id}>{data.detail.match.teamB.name}</option>
							</select>
						</label>
						<label class="grid gap-1.5">
							<span class="hud-label">Winner</span>
							<select name="winnerTeamId" class="hud-input px-3 py-2" value={game?.winnerTeamId ?? ''}>
								<option value="">Not decided</option>
								<option value={data.detail.match.teamA.id}>{data.detail.match.teamA.name}</option>
								<option value={data.detail.match.teamB.id}>{data.detail.match.teamB.name}</option>
							</select>
						</label>
						<label class="grid gap-1.5">
							<span class="hud-label">Game VOD</span>
							<input name="vodUrl" type="url" maxlength="500" value={game?.vodUrl ?? ''} class="hud-input px-3 py-2" />
						</label>
						<label class="grid gap-1.5 md:col-span-2 xl:col-span-3">
							<span class="hud-label">Game notes</span>
							<input name="notes" maxlength="500" value={game?.notes ?? ''} class="hud-input px-3 py-2" />
						</label>
						<button class="hud-cta self-end px-4 py-3">Save Game</button>
					</form>
				{/if}

				{#if game}
					<details class="border-t border-[var(--hud-variant)] p-4">
						<summary class="cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-[var(--hud-text)]">Vehicles &amp; Builds</summary>
						<div class="mt-4 grid gap-5 xl:grid-cols-2">
							{#each data.detail.rosters as roster}
								<section>
									<h4 class="font-semibold uppercase text-[var(--hud-text)]">{roster.teamName}</h4>
									<div class="mt-3 grid gap-2">
										{#each roster.members as member}
											{@const lineup = lineupFor(game.id, member.userId)}
											{@const build = buildFor(lineup?.buildSubmissionId ?? null)}
											{#if lineup || canEditPlayer(member.userId)}
												<div class="rounded-sm bg-[var(--hud-inset)] p-3">
													<div class="flex flex-wrap items-center justify-between gap-2">
														<a href="/players/{member.userId}" class="font-semibold text-[var(--hud-text)] hover:text-[var(--hud-teal)]">{member.displayName}</a>
														{#if lineup}<span class="text-xs text-[var(--hud-muted)]">{vehiclesById.get(lineup.vehicleId)?.name ?? lineup.vehicleId}</span>{/if}
													</div>
													{#if build && build.canOpen}
														<a href="/builds/{build.buildSlug}" class="mt-2 inline-block text-xs font-semibold text-[var(--hud-teal)]">{build.buildTitle} →</a>
													{/if}
													{#if canEditPlayer(member.userId)}
														<form method="POST" action="?/lineup" class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
															<input type="hidden" name="gameId" value={game.id} />
															<input type="hidden" name="userId" value={member.userId} />
															<select name="vehicleId" aria-label="Vehicle for {member.displayName}" class="hud-input px-2 py-1 text-xs" value={lineup?.vehicleId ?? ''}>
																<option value="">Not recorded</option>
																{#each data.detail.vehicles as vehicle}<option value={vehicle.id}>{vehicle.name}</option>{/each}
															</select>
															<select name="buildSubmissionId" aria-label="Build for {member.displayName}" class="hud-input px-2 py-1 text-xs" value={lineup?.buildSubmissionId ?? ''}>
																<option value="">No build</option>
																{#each submittedBuildsFor(member.userId) as option}<option value={option.id}>{option.buildTitle} · {option.vehicleName}</option>{/each}
															</select>
															<button class="hud-cta-outline px-3 py-1 text-xs">Save</button>
														</form>
													{/if}
												</div>
											{/if}
										{/each}
									</div>
								</section>
							{/each}
						</div>
					</details>
				{/if}
			</article>
		{:else}
			<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No game details have been recorded yet.</div>
		{/each}
	</div>
</section>

<style>
	.series-header {
		display: grid;
		gap: 2rem;
		align-items: end;
		padding: 2rem;
		background: linear-gradient(120deg, color-mix(in srgb, var(--hud-panel) 94%, var(--hud-teal)), var(--hud-inset));
		border-bottom: 1px solid var(--hud-variant);
		box-shadow: var(--hud-surface-ghost);
	}

	.series-pill {
		border-radius: 2px;
		background: color-mix(in srgb, var(--hud-teal) 16%, var(--hud-panel));
		color: var(--hud-text);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 0.3rem 0.6rem;
		text-transform: uppercase;
	}

	.series-score {
		display: grid;
		gap: 0.5rem;
		min-width: min(100%, 18rem);
	}

	.series-score div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		background: var(--hud-inset);
		padding: 0.75rem 1rem;
		color: var(--hud-text);
	}

	.series-score strong {
		font-family: var(--font-display);
		font-size: 2rem;
		color: var(--hud-teal);
	}

	.game-card {
		overflow: hidden;
		background: var(--hud-panel);
		box-shadow: var(--hud-surface-ghost);
	}

	.game-card__summary {
		position: relative;
		isolation: isolate;
		min-height: 15rem;
		overflow: hidden;
		background: linear-gradient(135deg, rgba(117, 241, 244, 0.14), rgba(116, 95, 255, 0.1));
	}

	.game-card__map,
	.game-card__scrim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.game-card__map {
		z-index: 0;
		object-fit: cover;
	}

	.game-card__scrim {
		z-index: 1;
		background: linear-gradient(90deg, rgba(5, 10, 20, 0.98), rgba(5, 10, 20, 0.72) 48%, rgba(5, 10, 20, 0.22));
	}

	.game-card__content {
		position: relative;
		z-index: 2;
		max-width: 42rem;
		padding: 2rem;
	}

	@media (min-width: 768px) {
		.series-header {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}
</style>

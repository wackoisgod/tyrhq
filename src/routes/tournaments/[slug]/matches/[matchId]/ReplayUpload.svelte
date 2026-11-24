<script lang="ts">
	import { parseReplayFile } from '$lib/replay-parser/worker-client';
	import type { ReplayParseProgress } from '$lib/replay-parser/parser';
	import type { ReplayAutoFill } from '$lib/replay/auto-fill';
	import type { ReplayPreview, ReplayUploadPayload } from '$lib/replay/upload-payload';

	interface GameDraft {
		gameNumber: number;
		mapId: string;
		pickedByTeamId: string;
		winnerTeamId: string;
		vodUrl: string;
		notes: string;
	}

	interface TeamOption {
		id: string;
		name: string;
	}

	type Preview = ReplayPreview & {
		existingGameNumber: number | null;
		autoFill: ReplayAutoFill;
	};

	let {
		matchId,
		preview = null,
		teamA,
		teamB,
		maps,
		gameFormData = $bindable()
	}: {
		matchId: string;
		preview?: Preview | null;
		teamA: TeamOption;
		teamB: TeamOption;
		maps: Array<{ id: string; name: string }>;
		gameFormData: GameDraft[];
	} = $props();

	let parsing = $state(false);
	let parseError = $state('');
	let progress = $state<ReplayParseProgress | null>(null);
	let parsed = $state<ReplayUploadPayload | null>(null);
	let gameNumber = $state(gameFormData[0]?.gameNumber ?? 1);
	let checked = $state<Record<string, boolean>>({});
	let prepared = $state(false);

	const payloadJson = $derived(parsed?.replayGuid ? JSON.stringify(parsed) : '');
	const selected = $derived(gameFormData.find((game) => game.gameNumber === Number(gameNumber)) ?? null);
	const acceptedIds = $derived(
		preview?.autoFill.players
			.filter((player) => player.matchedUserId && checked[player.matchedUserId])
			.map((player) => player.matchedUserId as string) ?? []
	);

	function phaseLabel(update: ReplayParseProgress) {
		if (update.phase === 'header') return 'Reading header';
		if (update.phase === 'netstream') return 'Reading match data';
		return 'Reading scoreboard';
	}

	function teamName(teamId: string | null) {
		if (teamId === teamA.id) return teamA.name;
		if (teamId === teamB.id) return teamB.name;
		return 'Unknown team';
	}

	function placeLabel(placement: 1 | 2 | null) {
		if (placement === 1) return '1st';
		if (placement === 2) return '2nd';
		return 'undecided';
	}

	function initialChecks(current: Preview | null) {
		const next: Record<string, boolean> = {};
		for (const player of current?.autoFill.players ?? []) {
			if (!player.matchedUserId) continue;
			next[player.matchedUserId] = player.matchMethod === 'steam_id' && !player.teamMismatch;
		}
		return next;
	}

	function useSuggestedWinner() {
		const suggestion = preview?.autoFill.suggestedWinnerTeamId;
		if (!suggestion || !selected) return;
		selected.winnerTeamId = suggestion;
	}

	$effect(() => {
		if (prepared || !preview) return;
		prepared = true;
		if (preview.existingGameNumber) gameNumber = preview.existingGameNumber;
		checked = initialChecks(preview);
		const suggestion = preview.autoFill.suggestedWinnerTeamId;
		const target = preview.existingGameNumber ?? gameNumber;
		const row = gameFormData.find((game) => game.gameNumber === Number(target));
		if (suggestion && row && !row.winnerTeamId) row.winnerTeamId = suggestion;
		const mapId = preview.autoFill.suggestedMapId;
		if (mapId && row && !row.mapId && maps.some((map) => map.id === mapId)) row.mapId = mapId;
	});

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		parsed = null;
		parseError = '';
		progress = null;
		if (!file) return;
		if (!file.name.toLowerCase().endsWith('.replay')) {
			parseError = 'Choose a .replay file.';
			input.value = '';
			return;
		}
		if (file.size > 100 * 1024 * 1024) {
			parseError = 'That replay is larger than 100MB.';
			input.value = '';
			return;
		}
		parsing = true;
		try {
			const result = await parseReplayFile(file, (update) => {
				progress = update;
			});
			if (!result.replayGuid) {
				parseError = result.warnings[0] ?? 'Could not read this replay.';
				return;
			}
			parsed = result;
		} catch (error) {
			parseError = error instanceof Error ? error.message : 'Could not parse this replay.';
		} finally {
			parsing = false;
		}
	}
</script>

<details class="hud-panel p-5" open={Boolean(parsed || preview)}>
	<summary class="cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-[var(--hud-text)]">
		Upload Replay
	</summary>
	<form method="POST" action="?/previewReplay" class="mt-4 grid gap-3">
		<input type="hidden" name="matchId" value={matchId} />
		<input type="hidden" name="payload" value={payloadJson} />
		<label class="grid gap-1.5">
			<span class="hud-label">Replay file</span>
			<input
				type="file"
				accept=".replay,application/octet-stream"
				class="hud-input px-3 py-2 text-sm"
				onchange={onFile}
				disabled={parsing}
			/>
			<span class="text-xs text-[var(--hud-muted)]">
				The file stays in your browser. Parsing runs locally, then only the scoreboard JSON is sent.
			</span>
		</label>

		{#if parsing && progress}
			<div
				class="h-2 overflow-hidden bg-[var(--hud-inset)]"
				role="progressbar"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress.fraction * 100)}
				aria-label={phaseLabel(progress)}
			>
				<div class="h-full bg-[var(--hud-teal)]" style="width: {Math.round(progress.fraction * 100)}%"></div>
			</div>
			<p class="text-xs text-[var(--hud-muted)]">{phaseLabel(progress)} · {Math.round(progress.fraction * 100)}%</p>
		{/if}

		{#if parseError}
			<p class="border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-3 py-2 text-sm text-[#ffd166]">{parseError}</p>
		{/if}

		{#if parsed?.replayGuid}
			<p class="text-sm text-[var(--hud-muted)]">
				Parsed {parsed.roster.length} players · version {parsed.changelist ?? 'unknown'}
			</p>
			{#if parsed.warnings.length > 0}
				<ul class="list-inside list-disc text-xs text-[#ffd166]">
					{#each parsed.warnings as warning}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}
			<button class="hud-cta w-fit px-4 py-2" disabled={parsing}>Review scoreboard</button>
		{/if}
	</form>

	{#if preview}
		<form method="POST" action="?/confirmReplay" class="mt-4 grid gap-4 border-t border-[var(--hud-variant)] pt-4">
			<input type="hidden" name="matchId" value={matchId} />
			<input type="hidden" name="payload" value={JSON.stringify(preview.payload)} />
			<input type="hidden" name="acceptedUserIds" value={JSON.stringify(acceptedIds)} />
			<input type="hidden" name="vodUrl" value={selected?.vodUrl ?? ''} />
			<input type="hidden" name="notes" value={selected?.notes ?? ''} />

			<div>
				<p class="text-sm font-semibold text-[var(--hud-text)]">Review before saving</p>
				<p class="mt-1 text-xs text-[var(--hud-muted)]">
					Replay {preview.payload.replayGuid.slice(0, 8)} · version {preview.payload.changelist ?? 'unknown'}.
					Nothing is stored until you confirm.
				</p>
				{#if preview.alreadyOnThisMatch}
					<p class="mt-2 text-sm text-[#ffd166]">
						This replay is already linked
						{#if preview.existingGameNumber}to game {preview.existingGameNumber}{/if}. Confirming that game replaces its scoreboard.
					</p>
				{/if}
				{#if preview.autoFill.warnings.length > 0}
					<ul class="mt-2 list-inside list-disc text-xs text-[#ffd166]">
						{#each preview.autoFill.warnings as warning}
							<li>{warning}</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="grid gap-2 text-sm">
				{#each preview.autoFill.teamPlacements as side}
					<p>
						<span class="font-semibold text-[var(--hud-text)]">{teamName(side.teamId)}</span>
						<span class="text-[var(--hud-muted)]">· {placeLabel(side.placement)}</span>
					</p>
				{/each}
			</div>

			{#if selected}
				<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<label class="grid gap-1.5">
						<span class="hud-label">Game</span>
						<select name="gameNumber" bind:value={gameNumber} class="hud-input px-3 py-2">
							{#each gameFormData as game}
								<option value={game.gameNumber}>{game.gameNumber}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1.5">
						<span class="hud-label">Map</span>
						<select name="mapId" bind:value={selected.mapId} class="hud-input px-3 py-2">
							<option value="">Select map</option>
							{#each maps as map}
								<option value={map.id}>{map.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1.5">
						<span class="hud-label">Picked by</span>
						<select name="pickedByTeamId" bind:value={selected.pickedByTeamId} class="hud-input px-3 py-2">
							<option value={teamA.id}>{teamA.name}</option>
							<option value={teamB.id}>{teamB.name}</option>
						</select>
					</label>
					<label class="grid gap-1.5">
						<span class="hud-label">Winner</span>
						<select name="winnerTeamId" bind:value={selected.winnerTeamId} class="hud-input px-3 py-2">
							<option value="">Not decided</option>
							<option value={teamA.id}>{teamA.name}</option>
							<option value={teamB.id}>{teamB.name}</option>
						</select>
					</label>
				</div>
			{/if}

			{#if preview.autoFill.suggestedWinnerTeamId}
				<button type="button" class="hud-cta-outline w-fit px-3 py-2 text-xs" onclick={useSuggestedWinner}>
					Use suggested winner ({teamName(preview.autoFill.suggestedWinnerTeamId)})
				</button>
			{/if}

			<div class="grid gap-2">
				{#each preview.autoFill.players as player}
					<label class="flex flex-wrap items-center gap-2 rounded bg-[var(--hud-inset)] px-3 py-2 text-xs">
						{#if player.matchedUserId}
							<input type="checkbox" bind:checked={checked[player.matchedUserId]} />
						{/if}
						<span class="font-semibold text-[var(--hud-text)]">#{player.placement} {player.name}</span>
						<span class="text-[var(--hud-muted)]">{teamName(player.teamId)}</span>
						{#if player.matchMethod === 'steam_id'}
							<span class="text-[var(--hud-teal)]">Steam ID</span>
						{:else if player.matchMethod === 'display_name'}
							<span class="text-[#ffd166]">Display name</span>
						{:else}
							<span class="text-[var(--hud-muted)]">No registered player</span>
						{/if}
						{#if player.teamMismatch}<span class="text-[#ffd166]">Team differs from roster</span>{/if}
						{#if player.vehicleName}<span class="text-[var(--hud-muted)]">{player.vehicleName}</span>{/if}
						<span class="text-[var(--hud-muted)]">
							K {player.stats.kills ?? '–'} · D {player.stats.damage ?? '–'} · B {player.stats.blocked ?? '–'} · A {player.stats.assist ?? '–'}
						</span>
					</label>
				{/each}
			</div>

			{#if !selected?.mapId}
				<p class="text-xs text-[var(--hud-muted)]">Select a map for this game before confirming.</p>
			{/if}
			<button class="hud-cta w-fit px-4 py-2" disabled={!selected?.mapId}>Confirm and save</button>
		</form>
	{/if}
</details>

<script lang="ts">
	import { parseReplayFile } from '$lib/replay-parser/worker-client';
	import type { ReplayParseProgress } from '$lib/replay-parser/parser';
	import type { ReplayPreview, ReplayUploadPayload } from '$lib/replay/upload-payload';

	let {
		matchId,
		preview = null
	}: {
		matchId: string;
		preview?: ReplayPreview | null;
	} = $props();

	let parsing = $state(false);
	let parseError = $state('');
	let progress = $state<ReplayParseProgress | null>(null);
	let parsed = $state<ReplayUploadPayload | null>(null);

	const payloadJson = $derived(parsed?.replayGuid ? JSON.stringify(parsed) : '');

	function phaseLabel(update: ReplayParseProgress) {
		if (update.phase === 'header') return 'Reading header';
		if (update.phase === 'netstream') return 'Reading match data';
		return 'Reading scoreboard';
	}

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
				Parsed {parsed.roster.length} players
				{#if parsed.winnerTeam === 0 || parsed.winnerTeam === 1}
					· replay team {parsed.winnerTeam} won
				{:else}
					· winner not found
				{/if}
				· version {parsed.changelist ?? 'unknown'}
			</p>
			{#if parsed.warnings.length > 0}
				<ul class="list-inside list-disc text-xs text-[#ffd166]">
					{#each parsed.warnings as warning}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}
			<button class="hud-cta w-fit px-4 py-2" disabled={parsing}>Send parsed replay</button>
		{/if}
	</form>

	{#if preview}
		<div class="mt-4 border-t border-[var(--hud-variant)] pt-4">
			<p class="text-sm text-[var(--hud-text)]">
				Replay <span class="font-semibold">{preview.payload.replayGuid.slice(0, 8)}</span>
				· version {preview.payload.changelist ?? 'unknown'}
				· {preview.payload.roster.length} players
			</p>
			{#if preview.alreadyOnThisMatch}
				<p class="mt-2 text-sm text-[#ffd166]">This replay is already recorded on a game in this match.</p>
			{/if}
			{#if preview.payload.warnings.length > 0}
				<ul class="mt-2 list-inside list-disc text-xs text-[#ffd166]">
					{#each preview.payload.warnings as warning}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}
			<ul class="mt-3 grid gap-1 text-xs text-[var(--hud-muted)]">
				{#each preview.payload.roster as player}
					<li>{player.name} · team {player.teamId}{player.clan ? ` · ${player.clan}` : ''}</li>
				{/each}
			</ul>
		</div>
	{/if}
</details>

<script lang="ts">
	import { enhance } from '$app/forms';

	type Application = {
		status: 'pending' | 'approved' | 'rejected';
		discordHandle: string;
		pastEvents: string;
		format: string;
		region: string;
		frequency: string;
		expectedPlayerCount: number;
		reviewNote: string | null;
		reviewedAt: string | null;
		createdAt: string;
	};

	type State = {
		available: boolean;
		steamLinked: boolean;
		isOrganizer: boolean;
		application: Application | null;
		canApply: boolean;
		blockedReason: string | null;
		reapplyAt: string | null;
	};

	let {
		state,
		discordDefault = '',
		form
	}: {
		state: State;
		discordDefault?: string | null;
		form: unknown;
	} = $props();

	const formRecord = $derived(
		form && typeof form === 'object' ? (form as Record<string, unknown>) : null
	);
	const errorMessage = $derived(
		typeof formRecord?.organizerError === 'string' ? formRecord.organizerError : null
	);
	const successMessage = $derived(
		typeof formRecord?.organizerSuccess === 'string' ? formRecord.organizerSuccess : null
	);

	function kept(key: string, fallback: string) {
		const value = formRecord?.[key];
		return typeof value === 'string' ? value : fallback;
	}

	const statusLabel: Record<Application['status'], string> = {
		pending: 'Awaiting review',
		approved: 'Approved',
		rejected: 'Not approved'
	};
</script>

<div class="mt-6 hud-panel p-8" id="organizer-application">
	<p class="hud-eyebrow tracking-[0.3em]">Tournaments</p>
	<h2 class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)]">
		Organize
	</h2>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Apply to run tournaments. Once an admin approves you, new events publish right away.
	</p>

	{#if !state.available}
		<p class="mt-6 text-sm text-[var(--hud-muted)]">{state.blockedReason}</p>
	{:else if state.isOrganizer}
		<p class="mt-6 text-sm text-[var(--hud-text)]">You can publish tournaments.</p>
		<a href="/tournaments/manage" class="mt-4 inline-block hud-cta px-4 py-2 text-sm">Tournament tools</a>
		{#if state.application}
			<p class="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--hud-dim)]">
				Application {statusLabel[state.application.status]}
			</p>
			{#if state.application.reviewNote}
				<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{state.application.reviewNote}</p>
			{/if}
		{/if}
	{:else}
		{#if successMessage}
			<p class="mt-6 rounded-sm bg-[var(--hud-teal)]/10 p-3 text-sm text-[var(--hud-teal)]">{successMessage}</p>
		{/if}
		{#if errorMessage}
			<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">{errorMessage}</p>
		{/if}

		{#if state.application}
			<div class="mt-6 rounded-sm bg-[var(--hud-panel-mid)] p-4">
				<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
					{statusLabel[state.application.status]}
				</p>
				<p class="mt-2 text-sm text-[var(--hud-text)]">
					{state.application.format} · {state.application.region} · {state.application.frequency}
				</p>
				<p class="mt-1 text-xs text-[var(--hud-muted)]">
					Discord {state.application.discordHandle} · about {state.application.expectedPlayerCount} players
				</p>
				{#if state.application.reviewNote}
					<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">{state.application.reviewNote}</p>
				{/if}
				{#if state.reapplyAt}
					<p class="mt-3 text-xs text-[var(--hud-dim)]">
						You can apply again on {new Date(state.reapplyAt).toLocaleDateString()}.
					</p>
				{/if}
			</div>
		{/if}

		{#if !state.steamLinked}
			<p class="mt-6 text-sm text-[var(--hud-muted)]">Link Steam on this page before you apply.</p>
		{:else if state.canApply}
			<form method="POST" action="?/applyOrganizer" use:enhance class="mt-6 grid gap-4">
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Discord</span>
					<input
						name="discord_handle"
						required
						maxlength="100"
						value={kept('organizerDiscord', discordDefault ?? '')}
						class="hud-input px-3 py-2"
					/>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Past events or community</span>
					<textarea
						name="past_events"
						required
						maxlength="2000"
						rows="4"
						class="hud-input px-3 py-2"
						placeholder="Links to events or communities you have run">{kept('organizerPastEvents', '')}</textarea>
				</label>
				<div class="grid gap-4 sm:grid-cols-3">
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Format</span>
						<input name="format" required maxlength="80" value={kept('organizerFormat', '')} class="hud-input px-3 py-2" placeholder="8v8 bracket" />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Region</span>
						<input name="region" required maxlength="80" value={kept('organizerRegion', '')} class="hud-input px-3 py-2" placeholder="NA" />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">How often</span>
						<input name="frequency" required maxlength="80" value={kept('organizerFrequency', '')} class="hud-input px-3 py-2" placeholder="Monthly" />
					</label>
				</div>
				<label class="flex flex-col gap-1.5 sm:max-w-xs">
					<span class="hud-label">Expected players</span>
					<input
						name="expected_player_count"
						type="number"
						required
						min="2"
						max="10000"
						value={kept('organizerPlayerCount', '64')}
						class="hud-input px-3 py-2"
					/>
				</label>
				<button class="hud-cta w-fit px-4 py-2 text-sm">Submit application</button>
			</form>
		{:else if state.blockedReason && !state.application}
			<p class="mt-6 text-sm text-[var(--hud-muted)]">{state.blockedReason}</p>
		{/if}
	{/if}
</div>

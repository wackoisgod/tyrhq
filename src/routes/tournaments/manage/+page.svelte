<script lang="ts">
	let { data, form } = $props();
	let startsAtLocal = $state('');
	let registrationClosesAtLocal = $state('');

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	}

	function isoFromLocal(value: string) {
		if (!value) return '';
		const time = new Date(value).getTime();
		return Number.isFinite(time) ? new Date(time).toISOString() : '';
	}

</script>

<svelte:head>
	<title>Tyr HQ | Tournament Organizer</title>
</svelte:head>

<section class="mx-auto max-w-6xl px-4 py-8 md:px-6">
	<div class="tyr-section-heading">
		<div class="tyr-shell-accent">
			<div class="tyr-shell-kicker">Organizer</div>
			<h1 class="tyr-section-title">Tournament Tools</h1>
		</div>
		<a href="/tournaments" class="hud-cta-ghost px-4 py-3">Public List</a>
	</div>

	{#if data.accessDenied}
		<div class="mt-6 hud-panel p-6 text-sm leading-6 text-[var(--hud-muted)]">
			Tournament organizer access is required. Ask an admin to flag your account as an organizer.
		</div>
	{:else}
		{#if form?.error}
			<div class="mt-6 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]">
				{form.error}
			</div>
		{/if}

		<div class="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
			<form method="POST" action="?/create" class="hud-panel flex flex-col gap-4 p-6">
				<div>
					<p class="hud-label">Create Tournament</p>
					<p class="mt-2 text-sm text-[var(--hud-muted)]">
						New open-registration tournaments publish immediately. Manual brackets stay draft until
						seeded.
					</p>
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Name</span>
					<input name="name" required maxlength="120" class="hud-input px-3 py-2" />
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Summary</span>
					<textarea name="summary" maxlength="500" rows="3" class="hud-input px-3 py-2"></textarea>
				</label>

				<div class="grid gap-3 sm:grid-cols-2">
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
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Mode</span>
						<select name="registrationMode" class="hud-input px-3 py-2">
							<option value="open">Open registration</option>
							<option value="manual_bracket">Manual bracket</option>
						</select>
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Team Size</span>
						<input type="text" value="8v8" readonly class="hud-input px-3 py-2" />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="hud-label">Subs</span>
						<input name="substituteCount" type="number" min="0" max="16" value="1" class="hud-input px-3 py-2" />
					</label>
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Rules URL</span>
					<input name="rulesUrl" type="url" maxlength="500" class="hud-input px-3 py-2" />
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="hud-label">Discord URL</span>
					<input name="discordUrl" type="url" maxlength="500" class="hud-input px-3 py-2" />
				</label>

				<button class="hud-cta px-5 py-3">Create Tournament</button>
			</form>

			<section>
				<p class="hud-label">Managed Tournaments</p>
				<div class="mt-3 grid gap-3">
					{#each data.tournaments as tournament}
						<a
							href="/tournaments/{tournament.slug}"
							class="rounded-sm bg-[var(--hud-panel)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<p class="hud-eyebrow">{tournament.status}</p>
							<h2 class="mt-1 text-lg font-semibold uppercase text-[var(--hud-text)]">
								{tournament.name}
							</h2>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">{formatDate(tournament.startsAt)}</p>
						</a>
					{:else}
						<div class="hud-panel p-6 text-sm text-[var(--hud-muted)]">No tournaments yet.</div>
					{/each}
				</div>
			</section>
		</div>
	{/if}
</section>

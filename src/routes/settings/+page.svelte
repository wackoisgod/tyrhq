<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let profileLoading = $state(false);
	let apiLoading = $state(false);

	const profileError = $derived(form && 'profileError' in form ? form.profileError : null);
	const profileSuccess = $derived(form && 'profileSuccess' in form ? form.profileSuccess : null);
	const apiError = $derived(form && 'apiError' in form ? form.apiError : null);
	const apiSuccess = $derived(form && 'apiSuccess' in form ? form.apiSuccess : null);
	const apiKey = $derived(form && 'apiKey' in form ? form.apiKey : null);
	const apiCredential = $derived(
		(form && 'apiCredential' in form ? form.apiCredential : null) ?? data.apiCredential
	);

	function formatTimestamp(value: string | null | undefined) {
		if (!value) return 'Never';

		return new Date(value).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Tyr HQ | {data.isOnboarding ? 'Welcome' : 'Settings'}</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-6 py-16">
	<div class="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
		<div class="hud-panel p-8">
			{#if data.isOnboarding}
				<p class="hud-eyebrow tracking-[0.35em]">Welcome, Pilot</p>
				<h1
					class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
				>
					Set Your Callsign
				</h1>
				<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">
					Choose a display name that will appear on public builds and developer API ownership.
				</p>
			{:else}
				<p class="hud-eyebrow tracking-[0.35em]">Pilot Profile</p>
				<h1
					class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
				>
					Settings
				</h1>
				<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">
					Manage your public callsign and the single API key tied to your account.
				</p>
			{/if}

			{#if profileError}
				<div
					class="mt-4 border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
				>
					{profileError}
				</div>
			{/if}

			{#if profileSuccess}
				<div
					class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]"
				>
					{profileSuccess}
				</div>
			{/if}

			<form
				method="POST"
				action="?/updateProfile"
				use:enhance={() => {
					profileLoading = true;
					return async ({ result, update }) => {
						profileLoading = false;
						await update();
						if (result.type === 'success' && data.isOnboarding) {
							await invalidateAll();
							goto('/');
							return;
						}

						if (result.type === 'success') {
							await invalidateAll();
						}
					};
				}}
				class="mt-6 flex flex-col gap-4"
			>
				<label class="flex flex-col gap-1.5">
					<span
						class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
					>
						Display Name
					</span>
					<input
						type="text"
						name="display_name"
						required
						maxlength={32}
						value={(form && 'displayName' in form ? form.displayName : null) ?? data.profile?.display_name ?? ''}
						class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
						placeholder="Enter your callsign"
					/>
					<span class="text-[11px] text-[var(--hud-dim)]">
						Shown on public builds and API ownership. Max 32 characters.
					</span>
				</label>

				<button type="submit" class="hud-cta px-5 py-3" disabled={profileLoading}>
					{#if profileLoading}
						Saving...
					{:else if data.isOnboarding}
						Continue
					{:else}
						Update Callsign
					{/if}
				</button>
			</form>

			{#if !data.isOnboarding}
				<div class="mt-8 hud-panel-muted p-4">
					<p class="hud-eyebrow tracking-[0.3em]">Session</p>
					<p class="mt-3 text-sm leading-6 text-[var(--hud-muted)]">
						Sign out here when you want to disconnect this browser from your Tyr HQ account.
					</p>
					<form method="POST" action="/auth/logout" class="mt-4">
						<button type="submit" class="hud-cta-ghost px-5 py-3">Sign Out</button>
					</form>
				</div>
			{/if}
		</div>

		{#if !data.isOnboarding}
			<div class="hud-panel p-8">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="hud-eyebrow tracking-[0.3em]">Developer API</p>
						<h2
							class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)]"
						>
							Public API Access
						</h2>
						<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
							Swagger docs are public at <a class="hud-link" href="/api/docs">/api/docs</a>, but live
							requests require the single API key attached to your account.
						</p>
					</div>

					<a href="/api/docs" class="hud-cta-outline px-4 py-2 text-sm">Open Swagger</a>
				</div>

				{#if apiError}
					<div
						class="mt-4 border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
					>
						{apiError}
					</div>
				{/if}

				{#if apiSuccess}
					<div
						class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]"
					>
						{apiSuccess}
					</div>
				{/if}

				{#if apiKey}
					<div
						class="mt-4 rounded-sm border border-[rgba(102,218,190,0.24)] bg-[rgba(102,218,190,0.08)] p-4 shadow-[inset_0_0_0_1px_rgba(102,218,190,0.08)]"
					>
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							One-Time Reveal
						</p>
						<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
							This key is shown only once. Rotate it if you lose it.
						</p>
						<code
							class="mt-3 block overflow-x-auto rounded-sm bg-[var(--hud-inset)] px-3 py-3 font-mono text-xs text-[var(--hud-text)]"
						>
							{apiKey}
						</code>
					</div>
				{/if}

				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					<div class="rounded-sm bg-[var(--hud-panel-mid)] p-4 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)]">
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							Status
						</p>
						<div class="mt-2 text-lg font-semibold text-[var(--hud-text)]">
							{#if !data.apiConfigured}
								Unavailable
							{:else if apiCredential?.status === 'active'}
								Active
							{:else if apiCredential?.status === 'revoked'}
								Revoked
							{:else}
								No Key
							{/if}
						</div>
						<p class="mt-1 text-sm text-[var(--hud-muted)]">
							{apiCredential?.fingerprint ?? 'Generate a key to authenticate against /api/v1.'}
						</p>
					</div>

					<div class="rounded-sm bg-[var(--hud-panel-mid)] p-4 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.22)]">
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							Last Used
						</p>
						<div class="mt-2 text-lg font-semibold text-[var(--hud-text)]">
							{formatTimestamp(apiCredential?.lastUsedAt)}
						</div>
						<p class="mt-1 text-sm text-[var(--hud-muted)]">
							Requests are rate limited to 60/minute and 5,000/day per key.
						</p>
					</div>
				</div>

				<div class="mt-6 grid gap-3 rounded-sm bg-[var(--hud-inset)] p-4 text-sm text-[var(--hud-muted)] sm:grid-cols-3">
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							Created
						</p>
						<p class="mt-1">{formatTimestamp(apiCredential?.createdAt)}</p>
					</div>
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							Rotated
						</p>
						<p class="mt-1">{formatTimestamp(apiCredential?.rotatedAt)}</p>
					</div>
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
							Revoked
						</p>
						<p class="mt-1">{formatTimestamp(apiCredential?.revokedAt)}</p>
					</div>
				</div>

				{#if !data.apiConfigured}
					<div
						class="mt-6 rounded-sm border border-[rgba(255,209,102,0.25)] bg-[rgba(255,209,102,0.08)] p-4 text-sm leading-6 text-[#ffd166]"
					>
						API key management is disabled until <code>SUPABASE_SERVICE_ROLE_KEY</code> is configured
						on the server.
					</div>
				{:else}
					<div class="mt-6 flex flex-wrap gap-3">
						<form
							method="POST"
							action="?/generateApiKey"
							use:enhance={() => {
								apiLoading = true;
								return async ({ update }) => {
									apiLoading = false;
									await update();
								};
							}}
						>
							<button type="submit" class="hud-cta px-5 py-3" disabled={apiLoading}>
								{#if apiLoading}
									Working...
								{:else if apiCredential?.hasActiveKey}
									Regenerate API Key
								{:else}
									Generate API Key
								{/if}
							</button>
						</form>

						{#if apiCredential?.status === 'active'}
							<form
								method="POST"
								action="?/revokeApiKey"
								use:enhance={() => {
									apiLoading = true;
									return async ({ update }) => {
										apiLoading = false;
										await update();
									};
								}}
							>
								<button type="submit" class="hud-cta-ghost px-5 py-3" disabled={apiLoading}>
									Revoke API Key
								</button>
							</form>
						{/if}
					</div>
				{/if}

				<div class="mt-6 rounded-sm bg-[var(--hud-panel-mid)] p-4 text-sm leading-6 text-[var(--hud-muted)]">
					<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
						Quick Start
					</p>
					<code class="mt-3 block overflow-x-auto rounded-sm bg-[var(--hud-inset)] px-3 py-3 font-mono text-xs text-[var(--hud-text)]">
curl -H "Authorization: Bearer YOUR_KEY" https://your-domain.example/api/v1/vehicles
					</code>
				</div>
			</div>
		{/if}
	</div>

	{#if !data.isOnboarding}
		<div class="mt-6 hud-panel p-8">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="hud-eyebrow tracking-[0.3em]">Contributions</p>
					<h2
						class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)]"
					>
						Write For Tyr HQ
					</h2>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
						Submit guides and news posts directly from the site — no GitHub, no PR. A reviewer
						will publish your draft or send notes back.
					</p>
				</div>
				<a href="/contribute/new" class="hud-cta px-4 py-2 text-sm">Write a new article</a>
			</div>

			<div class="mt-6 grid gap-3 sm:grid-cols-2">
				<a
					href="/contribute/mine"
					class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
				>
					<p
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
					>
						My contributions
					</p>
					<p class="mt-2 text-sm text-[var(--hud-text)]">
						Drafts, submissions in review, and reviewer notes.
					</p>
				</a>

				{#if data.role === 'contributor' || data.role === 'admin'}
					<a
						href="/admin/submissions"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Reviewer queue
							<span
								class="ml-2 rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--hud-on-teal)]"
							>
								{data.role === 'admin' ? 'ADMIN' : 'REVIEWER'}
							</span>
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Review pending submissions, request changes, or approve and publish.
						</p>
					</a>
				{/if}

				{#if data.role === 'contributor' || data.role === 'admin'}
					<a
						href="/admin/articles"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Article moderation
							<span
								class="ml-2 rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--hud-on-teal)]"
							>
								{data.role === 'admin' ? 'ADMIN' : 'REVIEWER'}
							</span>
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Every guide and article in any status. Withdraw a live row or restore a withdrawn
							one.
						</p>
					</a>
				{/if}

				{#if data.role === 'admin'}
					<a
						href="/admin/users"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							User roles
							<span
								class="ml-2 rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--hud-on-teal)]"
							>
								ADMIN
							</span>
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Promote trusted writers to reviewer or admin. Reviewers can approve and moderate;
							admins can also manage roles.
						</p>
					</a>
				{/if}
			</div>
		</div>
	{/if}
</section>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import SettingsNav from '$lib/components/settings/SettingsNav.svelte';

	let { data, form } = $props();

	let profileLoading = $state(false);

	const profileError = $derived(form && 'profileError' in form ? form.profileError : null);
	const profileSuccess = $derived(form && 'profileSuccess' in form ? form.profileSuccess : null);
</script>

<svelte:head>
	<title>Tyr HQ | {data.isOnboarding ? 'Welcome' : 'Settings'}</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-6 py-16">
	<div class="hud-panel p-8">
		{#if !data.isOnboarding}
			<div class="mb-6">
				<SettingsNav />
			</div>
		{/if}

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
				Manage your public callsign and control this session. Developer tooling lives under
				<a class="hud-link" href="/settings/api">Developer API</a>.
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

			<div class="flex flex-wrap gap-3">
				<button type="submit" class="hud-cta px-5 py-3" disabled={profileLoading}>
					{#if profileLoading}
						Saving...
					{:else if data.isOnboarding}
						Continue
					{:else}
						Update Callsign
					{/if}
				</button>
			</div>
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
		<div class="mt-6 hud-panel p-8">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="hud-eyebrow tracking-[0.3em]">Workshop</p>
					<h2
						class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)]"
					>
						My Work
					</h2>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
						Jump back into builds you've planned and shared.
					</p>
				</div>
				<a href="/tools/builds" class="hud-cta px-4 py-2 text-sm">New Build</a>
			</div>

			<div class="mt-6 grid gap-3 sm:grid-cols-2">
				<a
					href="/builds"
					class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
				>
					<p
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
					>
						My builds
					</p>
					<p class="mt-2 text-sm text-[var(--hud-text)]">
						All builds you've authored — open, share, or iterate.
					</p>
				</a>
			</div>
		</div>

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
					<p class="mt-3 font-mono text-2xl text-[var(--hud-text)]">
						{data.contributionCount}
					</p>
					<p class="text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]">
						approved edits to other authors' articles
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

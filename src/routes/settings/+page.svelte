<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { getAuthCallbackUrl } from '$lib/site-url';
	import { createBrowserClient } from '@supabase/ssr';
	import { onMount } from 'svelte';
	import SettingsNav from '$lib/components/settings/SettingsNav.svelte';
	import EventsPanel from '$lib/components/settings/EventsPanel.svelte';

	let { data, form } = $props();

	let profileLoading = $state(false);
	let supabase = $state<ReturnType<typeof createBrowserClient> | null>(null);
	let showEmailForm = $state(false);
	let emailFormData = $state({ email: '', password: '', confirmPassword: '' });
	let emailFormError = $state('');
	let emailFormLoading = $state(false);
	let pendingEmailChange = $state<string | null>(null);

	const profileError = $derived(form && 'profileError' in form ? form.profileError : null);
	const profileSuccess = $derived(form && 'profileSuccess' in form ? form.profileSuccess : null);
	
	// Check for success messages
	const urlSuccess = $page.url.searchParams.get('success');
	const successMessages: Record<string, string> = {
		google_linked: 'Google account linked successfully!',
		email_confirmed: 'Email confirmed successfully!',
		password_set: 'Password set successfully!'
	};
	const displaySuccess = profileSuccess || (urlSuccess && successMessages[urlSuccess]);

	onMount(() => {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return;
		supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			global: { fetch }
		});
		
		// Check for pending email change
		checkPendingEmailChange();
	});
	
	async function checkPendingEmailChange() {
		if (!supabase) return;
		
		const { data: { user } } = await supabase.auth.getUser();
		if (user && user.new_email) {
			pendingEmailChange = user.new_email;
		}
	}
	
	function validateEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}
	
	function validatePassword(password: string): boolean {
		return password.length >= 8;
	}
	
	async function handleSetPassword() {
		if (!supabase) return;
		
		emailFormError = '';
		
		// Validation
		if (!emailFormData.password || !validatePassword(emailFormData.password)) {
			emailFormError = 'Password must be at least 8 characters long.';
			return;
		}
		
		if (emailFormData.password !== emailFormData.confirmPassword) {
			emailFormError = 'Passwords do not match.';
			return;
		}
		
		emailFormLoading = true;
		
		try {
			// Set password on existing real email account
			const { error: passwordError } = await supabase.auth.updateUser({
				password: emailFormData.password
			});
			
			if (passwordError) {
				console.error('[settings] Failed to set password:', passwordError);
				emailFormError = 'Failed to set password. Please try again.';
				emailFormLoading = false;
				return;
			}
			
			// Success
			showEmailForm = false;
			emailFormData = { email: '', password: '', confirmPassword: '' };
			emailFormLoading = false;
			
			// Reload to show updated state
			await invalidateAll();
			goto('/settings?success=password_set');
		} catch (err) {
			console.error('[settings] Exception setting password:', err);
			emailFormError = 'An unexpected error occurred. Please try again.';
			emailFormLoading = false;
		}
	}
	
	async function handleAddEmail() {
		if (!supabase) return;
		
		emailFormError = '';
		
		// Validation
		if (!emailFormData.email || !validateEmail(emailFormData.email)) {
			emailFormError = 'Please enter a valid email address.';
			return;
		}
		
		if (!emailFormData.password || !validatePassword(emailFormData.password)) {
			emailFormError = 'Password must be at least 8 characters long.';
			return;
		}
		
		if (emailFormData.password !== emailFormData.confirmPassword) {
			emailFormError = 'Passwords do not match.';
			return;
		}
		
		emailFormLoading = true;
		
		try {
			// Set password FIRST (works on placeholder account, avoids half-done state)
			const { error: passwordError } = await supabase.auth.updateUser({
				password: emailFormData.password
			});
			
			if (passwordError) {
				console.error('[settings] Failed to set password:', passwordError);
				emailFormError = 'Failed to set password. Please try again.';
				emailFormLoading = false;
				return;
			}
			
			// Build callback URL with link marker
			const callbackUrl = getAuthCallbackUrl(window.location.origin, '/settings');
			const callbackWithMarker = `${callbackUrl}&link=email`;
			
			// Then update email (Supabase will send confirmation email)
			const { error: emailError } = await supabase.auth.updateUser(
				{ email: emailFormData.email },
				{
					emailRedirectTo: callbackWithMarker
				}
			);
			
			if (emailError) {
				console.error('[settings] Failed to update email:', emailError);
				
				// Map by error code if available, fallback to message
				const errorCode = (emailError as any).code || (emailError as any).error_code;
				if (errorCode === 'email_exists' || errorCode === 'email_address_taken') {
					emailFormError = 'This email is already in use by another account.';
				} else if (emailError.message?.toLowerCase().includes('already') || 
				           emailError.message?.toLowerCase().includes('exists')) {
					emailFormError = 'This email is already in use by another account.';
				} else {
					emailFormError = 'Failed to update email. Please try again.';
				}
				emailFormLoading = false;
				return;
			}
			
			// Success - show pending state
			pendingEmailChange = emailFormData.email;
			showEmailForm = false;
			emailFormData = { email: '', password: '', confirmPassword: '' };
			emailFormLoading = false;
			
			// Reload to show updated state
			await invalidateAll();
		} catch (err) {
			console.error('[settings] Exception adding email:', err);
			emailFormError = 'An unexpected error occurred. Please try again.';
			emailFormLoading = false;
		}
	}
	
	function cancelEmailForm() {
		showEmailForm = false;
		emailFormData = { email: '', password: '', confirmPassword: '' };
		emailFormError = '';
	}

	async function handleLinkGoogle() {
		if (!supabase) return;
		
		try {
			// Build callback URL with link marker to distinguish from normal sign-in
			const callbackUrl = getAuthCallbackUrl(window.location.origin, '/settings');
			const callbackWithMarker = `${callbackUrl}&link=google`;
			
			const { data: linkData, error } = await supabase.auth.linkIdentity({
				provider: 'google',
				options: {
					redirectTo: callbackWithMarker
				}
			});

			if (error) {
				console.error('[settings] Failed to link Google:', error);
				
				// Check for specific error types
				if (error.message?.includes('Manual linking') || error.message?.includes('disabled')) {
					goto('/settings?error=manual_linking_disabled');
				} else if (error.message?.includes('already') || error.message?.includes('linked')) {
					goto('/settings?error=identity_already_exists');
				} else {
					goto('/settings?error=link_failed');
				}
			}
			// If successful, linkIdentity will redirect to Google OAuth
		} catch (err) {
			console.error('[settings] Exception linking Google:', err);
			goto('/settings?error=link_failed');
		}
	}

	async function handleUnlinkGoogle() {
		if (!supabase) return;
		
		// Get current user to find Google identity
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;

		const googleIdentity = user.identities?.find((i) => i.provider === 'google');
		if (!googleIdentity) return;

		const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
		
		if (error) {
			console.error('[settings] Failed to unlink Google:', error);
			goto('/settings?error=unlink_failed');
		} else {
			await invalidateAll();
		}
	}

	// Check for linking errors from URL params
	const urlError = $page.url.searchParams.get('error');
	const errorMessages: Record<string, string> = {
		link_failed: 'Failed to link Google account. Please try again.',
		identity_already_exists: 'This Google account is already linked to another user.',
		manual_linking_disabled: 'Manual linking is not enabled. Contact your administrator.',
		unlink_failed: 'Failed to unlink account. You must have at least one sign-in method.',
		auth_callback_failed: 'Authentication failed. Please try again.',
		email_exists: 'This email is already in use by another account.',
		invalid_credentials: 'Invalid email or password.',
		email_change_failed: 'Failed to update email. Please try again.'
	};

	const displayError = $derived(profileError || (urlError && errorMessages[urlError]));

	// Check if user can unlink (must have at least 2 distinct usable sign-in methods)
	// Count distinct methods without double-counting:
	// - Google identity (can sign in via Google OAuth)
	// - Email+password (real email + email identity = can sign in with password)
	// - Verified Steam (profile.verified_steam_id = can sign in via Steam OpenID)
	const signInMethodCount = $derived(() => {
		let count = 0;
		
		// Google identity
		if (data.linkedIdentities.some((i) => i.provider === 'google')) {
			count += 1;
		}
		
		// Email+password (real email AND email identity)
		if (data.hasEmailPassword) {
			count += 1;
		}
		
		// Verified Steam
		if (data.profile?.verified_steam_id) {
			count += 1;
		}
		
		return count;
	});
	
	const canUnlinkGoogle = $derived(
		signInMethodCount() >= 2 && 
		data.linkedIdentities.some((i) => i.provider === 'google')
	);
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

		{#if displayError}
			<div
				class="mt-4 border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
			>
				{displayError}
			</div>
		{/if}

		{#if displaySuccess}
			<div
				class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]"
			>
				{displaySuccess}
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

			<label class="flex flex-col gap-1.5">
				<span
					class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
				>
					Discord Handle
				</span>
				<input
					type="text"
					name="discord_handle"
					maxlength={100}
					value={(form && 'discordHandle' in form ? form.discordHandle : null) ?? data.profile?.discord_handle ?? ''}
					class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
					placeholder="e.g., username or @username"
				/>
				<span class="text-[11px] text-[var(--hud-dim)]">
					Public Discord contact for team recruitment (optional).
				</span>
			</label>

			<label class="flex flex-col gap-1.5">
				<span
					class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
				>
					Steam Profile
				</span>
				<input
					type="text"
					name="steam_profile"
					maxlength={200}
					value={(form && 'steamProfile' in form ? form.steamProfile : null) ?? data.profile?.steam_profile ?? ''}
					class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
					placeholder="e.g., Steam profile URL or username"
				/>
				<span class="text-[11px] text-[var(--hud-dim)]">
					Public Steam contact for team recruitment (optional).
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
			<div class="mt-8 border-t border-[var(--hud-variant)] pt-6">
				<h2 class="text-xl font-semibold text-[var(--hud-text)]">Linked Accounts</h2>
				<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
					Manage your sign-in methods and linked accounts. Add multiple methods to access your account.
				</p>

				<div class="mt-4 space-y-3">
			<!-- Email/Password -->
			{#if data.hasEmailPassword}
				<!-- User has real email+password (can sign in with password) -->
				<div class="rounded-sm bg-[var(--hud-inset)] p-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-[var(--hud-teal)]">✓ Email & Password</p>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">{data.userEmail}</p>
						</div>
					</div>
				</div>
			{:else if pendingEmailChange}
				<!-- Email change pending confirmation -->
				<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-[var(--hud-muted)]">Email & Password (Pending)</p>
							<p class="mt-1 text-xs text-[var(--hud-dim)]">Check <span class="text-[var(--hud-text)]">{pendingEmailChange}</span> to confirm your email address.</p>
						</div>
					</div>
				</div>
			{:else if data.canSetPassword && !showEmailForm}
				<!-- User has real email (e.g. from Google) but no password set -->
				<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-[var(--hud-muted)]">Email (no password)</p>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">{data.userEmail}</p>
							<p class="mt-1 text-xs text-[var(--hud-dim)]">Set a password to enable email sign-in.</p>
						</div>
						<button 
							type="button"
							class="hud-cta-outline px-3 py-2 text-xs"
							onclick={() => showEmailForm = true}
						>
							Set Password
						</button>
					</div>
				</div>
			{:else if showEmailForm}
				<!-- Form for adding email+password or setting password -->
				<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
					<div class="space-y-3">
						<div>
							{#if data.canSetPassword}
								<p class="text-sm font-semibold text-[var(--hud-text)]">Set Password</p>
								<p class="mt-1 text-xs text-[var(--hud-dim)]">Create a password to enable email sign-in for {data.userEmail}.</p>
							{:else}
								<p class="text-sm font-semibold text-[var(--hud-text)]">Add Email & Password</p>
								<p class="mt-1 text-xs text-[var(--hud-dim)]">Set up email and password to enable password recovery and email sign-in.</p>
							{/if}
						</div>
						
						{#if emailFormError}
							<div class="rounded-sm bg-red-900/20 border border-red-700/50 p-3 text-xs text-red-200">
								{emailFormError}
							</div>
						{/if}
						
						<div class="space-y-2">
							{#if !data.canSetPassword}
								<label class="flex flex-col gap-1">
									<span class="text-xs font-semibold text-[var(--hud-muted)]">Email Address</span>
									<input
										type="email"
										bind:value={emailFormData.email}
										class="hud-input w-full px-3 py-2 text-sm text-[var(--hud-text)]"
										placeholder="your@email.com"
										disabled={emailFormLoading}
										required
									/>
								</label>
							{/if}
							
							<label class="flex flex-col gap-1">
								<span class="text-xs font-semibold text-[var(--hud-muted)]">Password</span>
								<input
									type="password"
									bind:value={emailFormData.password}
									class="hud-input w-full px-3 py-2 text-sm text-[var(--hud-text)]"
									placeholder="Minimum 8 characters"
									disabled={emailFormLoading}
									required
									minlength={8}
								/>
							</label>
							
							<label class="flex flex-col gap-1">
								<span class="text-xs font-semibold text-[var(--hud-muted)]">Confirm Password</span>
								<input
									type="password"
									bind:value={emailFormData.confirmPassword}
									class="hud-input w-full px-3 py-2 text-sm text-[var(--hud-text)]"
									placeholder="Re-enter password"
									disabled={emailFormLoading}
									required
									minlength={8}
								/>
							</label>
						</div>
						
						<div class="flex gap-2">
							<button 
								type="button" 
								class="hud-cta px-3 py-2 text-xs" 
								onclick={data.canSetPassword ? handleSetPassword : handleAddEmail}
								disabled={emailFormLoading}
							>
								{#if emailFormLoading}
									Saving...
								{:else if data.canSetPassword}
									Set Password
								{:else}
									Add Email
								{/if}
							</button>
							<button 
								type="button" 
								class="hud-cta-outline px-3 py-2 text-xs" 
								onclick={cancelEmailForm}
								disabled={emailFormLoading}
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			{:else}
				<!-- No email at all (Steam-only user with placeholder email) -->
				<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-[var(--hud-muted)]">Email & Password</p>
							<p class="mt-1 text-xs text-[var(--hud-dim)]">Not linked. Add an email to enable password recovery.</p>
						</div>
						<button 
							type="button"
							class="hud-cta-outline px-3 py-2 text-xs"
							onclick={() => showEmailForm = true}
						>
							Add Email
						</button>
					</div>
				</div>
			{/if}

				<!-- Google -->
				{#if data.linkedIdentities.some((i) => i.provider === 'google')}
					{@const googleIdentity = data.linkedIdentities.find((i) => i.provider === 'google')}
					<div class="rounded-sm bg-[var(--hud-inset)] p-4">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm font-semibold text-[var(--hud-teal)]">✓ Google</p>
								{#if googleIdentity?.email}
									<p class="mt-1 text-xs text-[var(--hud-muted)]">{googleIdentity.email}</p>
								{/if}
							</div>
							{#if canUnlinkGoogle}
								<button 
									type="button" 
									class="hud-cta-outline px-3 py-2 text-xs"
									onclick={handleUnlinkGoogle}
								>
									Unlink
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm font-semibold text-[var(--hud-muted)]">Google</p>
								<p class="mt-1 text-xs text-[var(--hud-dim)]">Not linked</p>
							</div>
							<button 
								type="button"
								class="hud-cta-outline px-3 py-2 text-xs"
								onclick={handleLinkGoogle}
							>
								Link Google
							</button>
						</div>
					</div>
				{/if}

					<!-- Steam -->
					{#if data.profile?.verified_steam_id}
						<div class="rounded-sm bg-[var(--hud-inset)] p-4">
							<div class="flex items-start justify-between gap-4">
								<div>
									<p class="text-sm font-semibold text-[var(--hud-teal)]">✓ Steam</p>
									{#if data.profile.steam_display_name}
										<p class="mt-1 text-xs text-[var(--hud-muted)]">Steam Name: {data.profile.steam_display_name}</p>
									{/if}
									<p class="mt-1 text-xs text-[var(--hud-dim)]">SteamID64: {data.profile.verified_steam_id}</p>
									{#if data.profile.steam_verified_at}
										<p class="mt-1 text-xs text-[var(--hud-dim)]">
											Verified {new Date(data.profile.steam_verified_at).toLocaleDateString()}
										</p>
									{/if}
								</div>
								<form method="POST" action="?/unlinkSteam">
									<button type="submit" class="hud-cta-outline px-3 py-2 text-xs">Unlink</button>
								</form>
							</div>
						</div>
					{:else}
						<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-sm font-semibold text-[var(--hud-muted)]">Steam</p>
									<p class="mt-1 text-xs text-[var(--hud-dim)]">Not linked. Link Steam for tournament match auto-matching.</p>
								</div>
								<a href="/auth/steam" class="hud-cta-outline px-3 py-2 text-xs">
									Link Steam
								</a>
							</div>
						</div>
					{/if}
				</div>
			</div>

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
				<a
					href="/teams"
					class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
				>
					<p
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
					>
						Teams
					</p>
					<p class="mt-2 text-sm text-[var(--hud-text)]">
						Create a team, join a roster, and track tournament records.
					</p>
				</a>
				{#if data.role === 'admin' || data.profile?.is_tournament_organizer}
					<a
						href="/tournaments/manage"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Tournament tools
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Create tournaments, seed brackets, and report match results.
						</p>
					</a>
				{/if}
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
						Submit guides, news posts, and community events directly from the site — no GitHub,
						no PR. A reviewer will publish your draft or send notes back.
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
						href="/admin/events"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Event queue
							<span
								class="ml-2 rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--hud-on-teal)]"
							>
								{data.role === 'admin' ? 'ADMIN' : 'REVIEWER'}
							</span>
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Approve or reject community-submitted events before they hit the calendar.
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
						href="/admin/community-links"
						class="rounded-sm bg-[var(--hud-panel-mid)] p-4 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
					>
						<p
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							Community links
							<span
								class="ml-2 rounded-sm bg-[var(--hud-teal)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--hud-on-teal)]"
							>
								ADMIN
							</span>
						</p>
						<p class="mt-2 text-sm text-[var(--hud-text)]">
							Curate the Discords, fan sites, and tools listed on the community page.
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

		<EventsPanel
			events={data.events}
			editEvent={data.editEvent}
			role={data.role}
			eventsEnabled={data.eventsEnabled}
		/>
	{/if}
</section>

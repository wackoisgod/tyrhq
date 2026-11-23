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
	let showSteamUnlinkConfirm = $state(false);
	let splitLoading = $state(false);
	let splitError = $state('');

	const profileError = $derived(form && 'profileError' in form ? form.profileError : null);
	const profileSuccess = $derived(form && 'profileSuccess' in form ? form.profileSuccess : null);
	
	// Check for success messages
	const urlSuccess = $page.url.searchParams.get('success');
	const successMessages: Record<string, string> = {
		google_linked: 'Google account added successfully!',
		steam_linked: 'Steam account added successfully!',
		email_confirmed: 'Email confirmed successfully!',
		password_set: 'Password set successfully!',
		accounts_merged: 'Accounts merged successfully! All data has been consolidated.',
		split_complete: 'Sign-in method split successfully! Sign in with that method to access your new account.',
		merge_undone: 'Merge undone successfully! The secondary account has been restored.'
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
				if (errorCode === 'email_exists' || errorCode === 'email_address_taken' ||
				    emailError.message?.toLowerCase().includes('already') || 
				    emailError.message?.toLowerCase().includes('exists')) {
					// Email exists on another account - initiate merge flow
					// User will prove ownership by signing in with that account's password or magic link
					try {
						const response = await fetch('/auth/merge/init', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							}
						});
						
						if (!response.ok) {
							emailFormError = 'Failed to initiate merge. Please try again.';
							emailFormLoading = false;
							return;
						}
						
						// Store email in sessionStorage to prefill on auth page
						sessionStorage.setItem('merge_email', emailFormData.email);
						
						// Sign out and redirect to auth with merge marker
						await supabase.auth.signOut();
						goto('/auth?merge=1&provider=email');
						return;
					} catch (err) {
						console.error('[settings] Exception initiating merge:', err);
						emailFormError = 'Failed to initiate merge. Please try again.';
						emailFormLoading = false;
						return;
					}
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
				} else {
					// For other errors (including identity_already_exists), show generic error
					// The actual merge routing will happen server-side in the callback handler
					goto('/settings?error=link_failed');
				}
			}
			// If successful, linkIdentity will redirect to Google OAuth
		} catch (err) {
			console.error('[settings] Exception linking Google:', err);
			goto('/settings?error=link_failed');
		}
	}

	// Google unlink is now handled by server action (see unlinkGoogle form below)
	// No client-side handler needed

	async function handleLinkSteam() {
		if (!supabase) return;
		
		try {
			// Build callback URL with link marker
			const callbackUrl = getAuthCallbackUrl(window.location.origin, '/settings');
			const callbackWithMarker = `${callbackUrl}&link=steam`;
			
			const { data: linkData, error } = await supabase.auth.linkIdentity({
				provider: 'steam' as any, // Custom provider registered in Supabase
				options: {
					redirectTo: callbackWithMarker
				}
			});

			if (error) {
				console.error('[settings] Failed to link Steam:', error);
				
				if (error.message?.includes('Manual linking') || error.message?.includes('disabled')) {
					goto('/settings?error=manual_linking_disabled');
				} else {
					goto('/settings?error=link_failed');
				}
			}
			// If successful, linkIdentity will redirect to Steam OAuth
		} catch (err) {
			console.error('[settings] Exception linking Steam:', err);
			goto('/settings?error=link_failed');
		}
	}

	async function handleSplitSignInMethod(provider: 'google' | 'email' | 'steam') {
		splitLoading = true;
		splitError = '';

		try {
			const response = await fetch('/auth/split/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider })
			});

			if (!response.ok) {
				const error = await response.json();
				splitError = error.message || 'Failed to initiate split. Please try again.';
				splitLoading = false;
				return;
			}

			// Redirect to confirmation page
			goto('/auth/split/confirm');
		} catch (err) {
			console.error('[settings] Exception initiating split:', err);
			splitError = 'An unexpected error occurred. Please try again.';
			splitLoading = false;
		}
	}

	// Check for linking errors from URL params
	const urlError = $page.url.searchParams.get('error');
	const errorMessages: Record<string, string> = {
		link_failed: 'Failed to link account. Please try again.',
		manual_linking_disabled: 'Manual linking is not enabled. Contact your administrator.',
		unlink_failed: 'Failed to unlink account. You must have at least one sign-in method.',
		auth_callback_failed: 'Authentication failed. Please try again.',
		invalid_credentials: 'Invalid email or password.',
		email_change_failed: 'Failed to update email. Please try again.',
		merge_expired: 'Account merge session expired. Please try again.',
		cannot_merge_self: 'Cannot add an account to itself. Please sign in with the other account.',
		steam_conflict: 'Your account already has a different Steam ID linked. Cannot link a different Steam account.',
		steam_already_linked: 'This Steam account is already linked to another TyrHQ account.',
		split_expired: 'Sign-in method split session expired. Please try again.',
		split_wrong_user: 'Session mismatch during split. Please restart the process.',
		unmerge_expired: 'Undo merge session expired. Please try again.',
		unmerge_unauthorized: 'You are not authorized to undo this merge.'
	};

	const displayError = $derived(profileError || (urlError && errorMessages[urlError]));

	// Use server-computed sign-in method guards (more secure than client-only)
	const canUnlinkGoogle = $derived(data.canUnlinkGoogle);
	const canUnlinkSteam = $derived(data.canUnlinkSteam);
	const canRemovePassword = $derived(data.canRemovePassword);
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
						<div class="flex-1">
							<p class="text-sm font-semibold text-[var(--hud-teal)]">✓ Email & Password</p>
							<p class="mt-1 text-xs text-[var(--hud-muted)]">{data.userEmail}</p>
							{#if !canRemovePassword}
								<p class="mt-2 text-xs text-[var(--hud-warning)]">
									⚠ This is your only sign-in method. Add Steam or Google before removing or splitting email+password.
								</p>
							{/if}
						</div>
						<div class="flex gap-2">
							{#if canRemovePassword}
								<form method="POST" action="?/removePassword"
									use:enhance={() => {
										return async ({ result, update }) => {
											await update();
											if (result.type === 'success') {
												await invalidateAll();
											}
										};
									}}
								>
									<button type="submit" class="hud-cta-outline px-3 py-2 text-xs">
										Remove
									</button>
								</form>
								<button 
									type="button"
									class="hud-btn-secondary px-3 py-2 text-xs"
									onclick={() => handleSplitSignInMethod('email')}
									disabled={splitLoading}
									title="Move email+password sign-in to a new empty account"
								>
									Split Off
								</button>
							{:else}
								<button 
									type="button"
									class="hud-cta-outline px-3 py-2 text-xs opacity-50 cursor-not-allowed"
									disabled
									title="Add another sign-in method first"
								>
									Remove
								</button>
								<button 
									type="button"
									class="hud-btn-secondary px-3 py-2 text-xs opacity-50 cursor-not-allowed"
									disabled
									title="Add another sign-in method first"
								>
									Split Off
								</button>
							{/if}
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
						<div class="flex-1">
							<p class="text-sm font-semibold text-[var(--hud-teal)]">✓ Google</p>
							{#if googleIdentity?.email}
								<p class="mt-1 text-xs text-[var(--hud-muted)]">{googleIdentity.email}</p>
							{/if}
							{#if !canUnlinkGoogle}
								<p class="mt-2 text-xs text-[var(--hud-warning)]">
									⚠ This is your only sign-in method. Add Steam or Email+Password before unlinking or splitting Google.
								</p>
							{/if}
						</div>
						<div class="flex gap-2">
							{#if canUnlinkGoogle}
								<form method="POST" action="?/unlinkGoogle"
									use:enhance={() => {
										return async ({ result, update }) => {
											await update();
											if (result.type === 'success') {
												await invalidateAll();
											}
										};
									}}
								>
									<button type="submit" class="hud-cta-outline px-3 py-2 text-xs">
										Unlink
									</button>
								</form>
								<button 
									type="button"
									class="hud-btn-secondary px-3 py-2 text-xs"
									onclick={() => handleSplitSignInMethod('google')}
									disabled={splitLoading}
									title="Move Google sign-in to a new empty account"
								>
									Split Off
								</button>
							{:else}
								<button 
									type="button"
									class="hud-cta-outline px-3 py-2 text-xs opacity-50 cursor-not-allowed"
									disabled
									title="Add another sign-in method first"
								>
									Unlink
								</button>
								<button 
									type="button"
									class="hud-btn-secondary px-3 py-2 text-xs opacity-50 cursor-not-allowed"
									disabled
									title="Add another sign-in method first"
								>
									Split Off
								</button>
							{/if}
						</div>
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
							<div class="flex-1">
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
								{#if !canUnlinkSteam}
									<p class="mt-2 text-xs text-[var(--hud-warning)]">
										⚠ This is your only sign-in method. Add Google or Email+Password before unlinking or splitting Steam.
									</p>
								{/if}
							</div>
							<div class="flex gap-2">
								{#if canUnlinkSteam}
									{#if showSteamUnlinkConfirm}
										<div class="flex flex-col gap-2">
											<form method="POST" action="?/unlinkSteam"
												use:enhance={() => {
													return async ({ result, update }) => {
														showSteamUnlinkConfirm = false;
														await update();
														if (result.type === 'success') {
															await invalidateAll();
														}
													};
												}}
											>
												<button type="submit" class="hud-cta-outline px-3 py-2 text-xs bg-red-900/20 border-red-700/50 text-red-200 hover:bg-red-900/30">
													Confirm Unlink
												</button>
											</form>
											<button 
												type="button"
												class="hud-cta-outline px-3 py-2 text-xs"
												onclick={() => showSteamUnlinkConfirm = false}
											>
												Cancel
											</button>
										</div>
									{:else}
										<button 
											type="button"
											class="hud-cta-outline px-3 py-2 text-xs"
											onclick={() => showSteamUnlinkConfirm = true}
										>
											Unlink
										</button>
										<button 
											type="button"
											class="hud-btn-secondary px-3 py-2 text-xs"
											onclick={() => handleSplitSignInMethod('steam')}
											disabled={splitLoading}
											title="Move Steam sign-in to a new empty account"
										>
											Split Off
										</button>
									{/if}
								{:else}
									<button 
										type="button"
										class="hud-cta-outline px-3 py-2 text-xs opacity-50 cursor-not-allowed"
										disabled
										title="Add another sign-in method first"
									>
										Unlink
									</button>
									<button 
										type="button"
										class="hud-btn-secondary px-3 py-2 text-xs opacity-50 cursor-not-allowed"
										disabled
										title="Add another sign-in method first"
									>
										Split Off
									</button>
								{/if}
							</div>
						</div>
						{#if showSteamUnlinkConfirm}
							<div class="mt-3 rounded-sm bg-[var(--hud-warning)]/10 border border-[var(--hud-warning)]/30 p-3 text-xs text-[var(--hud-muted)]">
								<p class="font-semibold text-[var(--hud-warning)]">⚠ Warning</p>
								<p class="mt-1">
									If you have tournament registrations or are on team rosters tied to your Steam account, 
									you will need to re-verify your Steam identity to participate in those tournaments again.
								</p>
								<p class="mt-1">
									Your tournament history will remain intact, but you'll lose the association until you re-link Steam.
								</p>
							</div>
						{/if}
					</div>
				{:else}
					<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm font-semibold text-[var(--hud-muted)]">Steam</p>
								<p class="mt-1 text-xs text-[var(--hud-dim)]">Not linked. Link Steam for tournament match auto-matching.</p>
							</div>
							<button 
								type="button"
								onclick={handleLinkSteam}
								class="hud-cta-outline px-3 py-2 text-xs"
							>
								Link Steam
							</button>
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

			<!-- Merged Accounts History -->
			{#if data.mergeHistory && data.mergeHistory.length > 0}
				<div class="mt-8 border-t border-[var(--hud-variant)] pt-6">
					<h2 class="text-xl font-semibold text-[var(--hud-text)]">Merged Accounts</h2>
					<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">
						History of accounts you've merged into this one. You can undo recent merges.
					</p>

					<div class="mt-4 space-y-3">
						{#each data.mergeHistory as merge}
							<div class="rounded-sm bg-[var(--hud-panel-mid)] border border-[var(--hud-variant)] p-4">
								<div class="flex items-start justify-between gap-4">
									<div class="flex-1">
										<p class="text-sm font-semibold text-[var(--hud-text)]">
											{#if merge.status === 'undone'}
												<span class="text-[var(--hud-muted)]">⟲ Undone Merge</span>
											{:else}
												Merged Account
											{/if}
										</p>
										{#if merge.secondary_email}
											<p class="mt-1 text-xs text-[var(--hud-muted)]">
												Email: {merge.secondary_email}
											</p>
										{/if}
										{#if merge.secondary_display_name}
											<p class="mt-1 text-xs text-[var(--hud-muted)]">
												Name: {merge.secondary_display_name}
											</p>
										{/if}
										{#if merge.secondary_steam_id}
											<p class="mt-1 text-xs text-[var(--hud-muted)]">
												Steam: {merge.secondary_steam_id}
											</p>
										{/if}
										<p class="mt-2 text-xs text-[var(--hud-dim)]">
											Merged: {new Date(merge.merged_at).toLocaleString()}
										</p>
										{#if merge.undone_at}
											<p class="mt-1 text-xs text-[var(--hud-dim)]">
												Undone: {new Date(merge.undone_at).toLocaleString()}
											</p>
										{/if}
									</div>
									{#if merge.status === 'completed'}
										<button 
											type="button"
											class="hud-cta-outline px-3 py-2 text-xs"
											onclick={async () => {
												try {
													const response = await fetch('/auth/unmerge/init', {
														method: 'POST',
														headers: { 'Content-Type': 'application/json' },
														body: JSON.stringify({ mergeId: merge.id })
													});
													
													if (!response.ok) {
														const error = await response.json();
														alert(error.message || 'Failed to initiate undo');
														return;
													}
													
													// Redirect to confirmation page
													goto('/auth/unmerge/confirm');
												} catch (err) {
													console.error('Error initiating undo:', err);
													alert('Failed to initiate undo. Please try again.');
												}
											}}
											title="Undo this merge and restore the secondary account"
										>
											Undo Merge
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
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

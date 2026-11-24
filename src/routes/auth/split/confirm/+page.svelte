<script lang="ts">
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { getAuthCallbackUrl } from '$lib/site-url';
	import { createBrowserClient } from '@supabase/ssr';
	import { onMount } from 'svelte';

	let { data } = $props();

	let supabase = $state<ReturnType<typeof createBrowserClient> | null>(null);
	let loading = $state(false);
	let error = $state('');

	const providerNames = {
		google: 'Google',
		email: 'Email+Password',
		steam: 'Steam'
	};

	onMount(() => {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return;
		supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			global: { fetch }
		});
	});

	async function handleReauthenticate() {
		if (!supabase) return;

		loading = true;
		error = '';

		try {
			if (data.provider === 'google' || data.provider === 'steam') {
				// Redirect to OAuth for re-authentication (Google or Steam)
				const callbackUrl = getAuthCallbackUrl(window.location.origin, '/auth/split/complete');
				const oauthProvider = data.provider === 'steam' ? 'custom:steam' : 'google';
				
				const oauthOptions: any = {
					redirectTo: callbackUrl
				};
				
				// Force account selection for Google
				if (data.provider === 'google') {
					oauthOptions.queryParams = {
						prompt: 'select_account'
					};
				}

				const { data: authData, error: authError } = await supabase.auth.signInWithOAuth({
					provider: oauthProvider as any,
					options: oauthOptions
				});

				if (authError) {
					console.error(`[split] ${data.provider} auth error:`, authError);
					error = `Failed to authenticate with ${providerNames[data.provider]}. Please try again.`;
					loading = false;
				}
				// OAuth will redirect away
			} else if (data.provider === 'email') {
				// Redirect to email login form
				goto('/auth/split/complete?provider=email');
			}
		} catch (err) {
			console.error('[split] Re-authentication error:', err);
			error = 'An unexpected error occurred. Please try again.';
			loading = false;
		}
	}

	function handleCancel() {
		goto('/settings');
	}
</script>

<svelte:head>
	<title>Tyr HQ | Confirm Sign-In Method Split</title>
</svelte:head>

<section class="mx-auto max-w-2xl px-6 py-16">
	<div class="hud-panel p-8">
		<p class="hud-eyebrow tracking-[0.35em]">Account Security</p>
		<h1
			class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
		>
			Split Sign-In Method
		</h1>

		<div class="mt-6 space-y-4 text-sm leading-6 text-[var(--hud-muted)]">
			<p>
				You're about to split your <strong class="text-[var(--hud-text)]"
					>{providerNames[data.provider]}</strong
				> sign-in method into a new, separate account.
			</p>

			<div class="rounded bg-[var(--hud-inset)] p-4">
				<p class="font-semibold text-[var(--hud-text)]">What happens:</p>
				<ul class="mt-2 list-inside list-disc space-y-1">
					<li>
						Your <strong>{providerNames[data.provider]}</strong> login will be removed from this account
					</li>
					<li>A brand new account will be created with that sign-in method</li>
					<li>All your builds, teams, and data stay on this account</li>
					<li>The new account will be empty (no builds or data)</li>
				</ul>
			</div>

			<p class="text-[var(--hud-warning)]">
				<strong>Important:</strong> You must re-authenticate with
				{providerNames[data.provider]} to prove you own this sign-in method before the split.
			</p>

			{#if error}
				<div
					class="border-l-2 border-[var(--hud-warning)] bg-[var(--hud-inset)] px-4 py-3 text-[var(--hud-warning)]"
				>
					{error}
				</div>
			{/if}
		</div>

		<div class="mt-8 flex gap-4">
			<button
				type="button"
				onclick={handleReauthenticate}
				disabled={loading}
				class="hud-btn-primary flex-1"
			>
				{loading ? 'Authenticating...' : `Re-authenticate with ${providerNames[data.provider]}`}
			</button>
			<button type="button" onclick={handleCancel} disabled={loading} class="hud-btn-secondary">
				Cancel
			</button>
		</div>
	</div>
</section>

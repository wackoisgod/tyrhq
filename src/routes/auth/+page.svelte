<script lang="ts">
	import { enhance } from '$app/forms';
	import { env } from '$env/dynamic/public';
	import { getAbsoluteUrl } from '$lib/site-url';
	import { createBrowserClient } from '@supabase/ssr';
	import { onMount } from 'svelte';

	let { form } = $props();

	let mode = $state<'login' | 'signup' | 'forgot'>('login');
	let loading = $state(false);
	let supabase = $state<ReturnType<typeof createBrowserClient> | null>(null);

	const supabaseConfigured = $derived(
		Boolean(env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_ANON_KEY)
	);

	onMount(() => {
		if (!supabaseConfigured) return;
		supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL!, env.PUBLIC_SUPABASE_ANON_KEY!, {
			global: { fetch }
		});
	});

	function handleOAuth(provider: 'discord' | 'google') {
		if (!supabase) return;
		supabase.auth.signInWithOAuth({
			provider,
			options: {
				redirectTo: getAbsoluteUrl('/auth/callback', window.location.origin)
			}
		});
	}

	const headings: Record<typeof mode, { eyebrow: string; title: string }> = {
		login: { eyebrow: 'Authentication', title: 'Sign In' },
		signup: { eyebrow: 'Authentication', title: 'Create Account' },
		forgot: { eyebrow: 'Recovery', title: 'Reset Password' }
	};
</script>

<svelte:head>
	<title>Tyr HQ | {headings[mode].title}</title>
</svelte:head>

<section class="mx-auto max-w-md px-6 py-16">
	{#if !supabaseConfigured}
		<div class="hud-panel p-8">
			<p class="hud-eyebrow tracking-[0.35em]">System Offline</p>
			<h1
				class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
			>
				Auth Not Configured
			</h1>
			<p class="mt-5 text-sm leading-7 text-[var(--hud-muted)]">
				Set <code class="font-[var(--font-mono)] text-[var(--hud-teal)]"
					>PUBLIC_SUPABASE_URL</code
				>
				and
				<code class="font-[var(--font-mono)] text-[var(--hud-teal)]"
					>PUBLIC_SUPABASE_ANON_KEY</code
				>
				in your <code class="font-[var(--font-mono)]">.env</code> file to enable authentication.
			</p>
		</div>
	{:else}
		<div class="hud-panel p-8">
			<p class="hud-eyebrow tracking-[0.35em]">{headings[mode].eyebrow}</p>
			<h1
				class="mt-4 font-[var(--font-display)] text-4xl font-bold uppercase text-[var(--hud-text)]"
			>
				{headings[mode].title}
			</h1>

			{#if form?.error}
				<div
					class="mt-4 border-l-2 border-[var(--hud-warning,#ffd166)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[#ffd166]"
				>
					{form.error}
				</div>
			{/if}

			{#if form?.success}
				<div
					class="mt-4 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-3 text-sm text-[var(--hud-teal)]"
				>
					{form.success}
				</div>
			{/if}

			{#if mode === 'forgot'}
				<form
					method="POST"
					action="?/forgot"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							loading = false;
							await update();
						};
					}}
					class="mt-6 flex flex-col gap-4"
				>
					<label class="flex flex-col gap-1.5">
						<span
							class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
							>Email</span
						>
						<input
							type="email"
							name="email"
							required
							value={form?.email ?? ''}
							class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
							placeholder="pilot@tyr.gg"
						/>
					</label>

					<button type="submit" class="hud-cta px-5 py-3" disabled={loading}>
						{loading ? 'Sending…' : 'Send Reset Link'}
					</button>

					<button
						type="button"
						class="text-sm text-[var(--hud-muted)] transition hover:text-[var(--hud-teal)]"
						onclick={() => (mode = 'login')}
					>
						Back to sign in
					</button>
				</form>
			{:else}
				<form
					method="POST"
					action={mode === 'login' ? '?/login' : '?/signup'}
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							loading = false;
							await update();
						};
					}}
					class="mt-6 flex flex-col gap-4"
				>
					<label class="flex flex-col gap-1.5">
						<span
							class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
							>Email</span
						>
						<input
							type="email"
							name="email"
							required
							value={form?.email ?? ''}
							class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
							placeholder="pilot@tyr.gg"
						/>
					</label>

					<label class="flex flex-col gap-1.5">
						<span
							class="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]"
							>Password</span
						>
						<input
							type="password"
							name="password"
							required
							minlength={mode === 'signup' ? 6 : undefined}
							class="hud-input w-full px-3 py-2.5 text-sm text-[var(--hud-text)]"
							placeholder="••••••••"
						/>
					</label>

					<button type="submit" class="hud-cta px-5 py-3" disabled={loading}>
						{#if loading}
							{mode === 'login' ? 'Signing in…' : 'Creating account…'}
						{:else}
							{mode === 'login' ? 'Sign In' : 'Create Account'}
						{/if}
					</button>

					{#if mode === 'login'}
						<button
							type="button"
							class="text-left text-sm text-[var(--hud-muted)] transition hover:text-[var(--hud-teal)]"
							onclick={() => (mode = 'forgot')}
						>
							Forgot password?
						</button>
					{/if}
				</form>

				<hr class="hud-divider my-6" />

				<div class="flex flex-col gap-3">
					<button
						type="button"
						class="hud-cta-ghost w-full px-5 py-3"
						onclick={() => handleOAuth('google')}
					>
						Continue with Google
					</button>

					<button
						type="button"
						class="hud-cta-ghost w-full px-5 py-3 opacity-40 cursor-not-allowed"
						disabled
						title="Discord authentication coming soon"
					>
						Continue with Discord (Soon)
					</button>

					<button
						type="button"
						class="hud-cta-ghost w-full px-5 py-3 opacity-40 cursor-not-allowed"
						disabled
						title="Steam authentication coming soon"
					>
						Continue with Steam (Soon)
					</button>
				</div>

				<hr class="hud-divider my-6" />

				{#if mode === 'login'}
					<p class="text-center text-sm text-[var(--hud-muted)]">
						No account?
						<button
							type="button"
							class="text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
							onclick={() => (mode = 'signup')}
						>
							Create one
						</button>
					</p>
				{:else}
					<p class="text-center text-sm text-[var(--hud-muted)]">
						Already have an account?
						<button
							type="button"
							class="text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
							onclick={() => (mode = 'login')}
						>
							Sign in
						</button>
					</p>
				{/if}
			{/if}
		</div>
	{/if}
</section>

import { fail, redirect } from '@sveltejs/kit';
import { getAuthCallbackUrl } from '$lib/site-url';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const { session } = await locals.safeGetSession();
	
	// Check if this is a merge flow
	const isMergeFlow = url.searchParams.get('merge') === '1';
	
	if (isMergeFlow) {
		// Verify merge cookie exists
		const { verifyMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
		const mergeCookie = verifyMergeCookie(cookies.get(MERGE_COOKIE_NAME));
		
		if (!mergeCookie) {
			// Invalid or expired merge cookie - redirect to settings
			redirect(303, '/settings?error=merge_expired');
		}
		
		// If user is signed in, sign them out (but keep merge cookie)
		if (session) {
			await locals.supabase.auth.signOut();
		}
		
		// Show sign-in page for secondary account
		return { isMergeFlow: true };
	}
	
	// Normal flow - redirect if already signed in
	if (session) redirect(303, '/');
	return { isMergeFlow: false };
};

export const actions: Actions = {
	login: async ({ request, locals, cookies }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { error: 'Email and password are required', email });
		}

		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
		if (error) {
			console.error('[auth] Login failed', error);
			return fail(400, { error: 'Invalid email or password', email });
		}

		// Check if this is a merge flow
		const { verifyMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
		const mergeCookie = verifyMergeCookie(cookies.get(MERGE_COOKIE_NAME));
		
		if (mergeCookie && mergeCookie.phase === 'initiated') {
			// Redirect to merge confirmation
			redirect(303, '/auth/merge/confirm');
		}

		redirect(303, '/');
	},

	signup: async ({ request, locals, url }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { error: 'Email and password are required', email });
		}

		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters', email });
		}

		const { error } = await locals.supabase.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: getAuthCallbackUrl(url.origin) }
		});
		if (error) {
			console.error('[auth] Signup failed', error);
			return fail(400, { error: 'Unable to create an account right now', email });
		}

		return { success: 'Check your email for a confirmation link.' };
	},

	forgot: async ({ request, locals, url }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;

		if (!email) {
			return fail(400, { error: 'Email is required' });
		}

		const { error } = await locals.supabase.auth.resetPasswordForEmail(email, {
			redirectTo: getAuthCallbackUrl(url.origin, '/auth')
		});
		if (error) {
			console.error('[auth] Password reset failed', error);
			return { success: 'If an account exists for that email, a reset link will be sent.' };
		}

		return { success: 'Check your email for a password reset link.' };
	},

	logout: async ({ locals, cookies }) => {
		// Clear merge cookie if present
		const { deleteMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);
		
		await locals.supabase.auth.signOut();
		redirect(303, '/');
	}
};

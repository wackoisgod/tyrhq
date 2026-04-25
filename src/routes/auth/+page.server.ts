import { fail, redirect } from '@sveltejs/kit';
import { getAbsoluteUrl } from '$lib/site-url';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { session } = await locals.safeGetSession();
	if (session) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	login: async ({ request, locals }) => {
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

		redirect(303, '/');
	},

	signup: async ({ request, locals }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { error: 'Email and password are required', email });
		}

		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters', email });
		}

		const { error } = await locals.supabase.auth.signUp({ email, password });
		if (error) {
			console.error('[auth] Signup failed', error);
			return fail(400, { error: 'Unable to create an account right now', email });
		}

		return { success: 'Check your email for a confirmation link.' };
	},

	forgot: async ({ request, locals }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;

		if (!email) {
			return fail(400, { error: 'Email is required' });
		}

		const { error } = await locals.supabase.auth.resetPasswordForEmail(email, {
			redirectTo: getAbsoluteUrl('/auth/callback?next=/auth', new URL(request.url).origin)
		});
		if (error) {
			console.error('[auth] Password reset failed', error);
			return { success: 'If an account exists for that email, a reset link will be sent.' };
		}

		return { success: 'Check your email for a password reset link.' };
	},

	logout: async ({ locals }) => {
		await locals.supabase.auth.signOut();
		redirect(303, '/');
	}
};

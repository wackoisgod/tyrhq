import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
	depends('supabase:auth');
	const { session, user } = await locals.safeGetSession();

	let profile: { display_name: string } | null = null;
	if (user && locals.supabase) {
		const { data } = await locals.supabase
			.from('profiles')
			.select('display_name')
			.eq('id', user.id)
			.single();
		profile = data;
	}

	// Redirect to settings if logged in but no display name set (first-time onboarding)
	const path = url.pathname;
	if (
		user &&
		(!profile || !profile.display_name) &&
		!path.startsWith('/settings') &&
		!path.startsWith('/auth') &&
		!path.startsWith('/api')
	) {
		redirect(303, '/settings');
	}

	return { session, user, profile };
};

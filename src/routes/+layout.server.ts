import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { listFlyoutEntries } from '$lib/server/articles';
import { countPendingReviewSubmissions } from '$lib/server/submissions';

export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
	depends('supabase:auth');
	const { session, user, role } = await locals.safeGetSession();

	let profile: { display_name: string; is_tournament_organizer?: boolean | null } | null = null;
	if (user && locals.supabase) {
		const { data, error } = await locals.supabase
			.from('profiles')
			.select('display_name, is_tournament_organizer')
			.eq('id', user.id)
			.single();
		profile = data;
		if (error?.message?.includes('is_tournament_organizer')) {
			const fallback = await locals.supabase
				.from('profiles')
				.select('display_name')
				.eq('id', user.id)
				.single<{ display_name: string }>();
			profile = fallback.data ? { ...fallback.data, is_tournament_organizer: false } : null;
		}
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

	const flyoutEntries = await listFlyoutEntries();

	const pendingReviewCount =
		role === 'contributor' || role === 'admin' ? await countPendingReviewSubmissions() : 0;

	return {
		session,
		user,
		profile,
		role,
		isTournamentOrganizer: Boolean(profile?.is_tournament_organizer),
		flyoutEntries,
		pendingReviewCount
	};
};

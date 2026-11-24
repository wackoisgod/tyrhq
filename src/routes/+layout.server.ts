import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { listFlyoutEntries } from '$lib/server/articles';
import { countPendingReviewSubmissions } from '$lib/server/submissions';
import { countPendingEvents } from '$lib/server/events';

export const load: LayoutServerLoad = async ({ locals, depends, url, untrack }) => {
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

	const isReviewer = role === 'contributor' || role === 'admin';
	const needsOnboarding = !!user && (!profile || !profile.display_name);

	// Reading `url.pathname` makes SvelteKit re-run this load (session check,
	// profile, flyout entries, pending counts) on every client-side navigation,
	// which doubles the upstream calls behind each `__data.json`. Only track it
	// where per-navigation re-runs matter: enforcing the onboarding redirect and
	// keeping reviewer counts fresh. Everyone else re-runs on auth changes only,
	// via the `supabase:auth` dependency (settings calls invalidateAll on save).
	const path = needsOnboarding || isReviewer ? url.pathname : untrack(() => url.pathname);

	// Redirect to settings if logged in but no display name set (first-time onboarding)
	if (
		needsOnboarding &&
		!path.startsWith('/settings') &&
		!path.startsWith('/auth') &&
		!path.startsWith('/api')
	) {
		redirect(303, '/settings');
	}

	const flyoutEntries = await listFlyoutEntries();

	const [pendingReviewCount, pendingEventCount] = isReviewer
		? await Promise.all([countPendingReviewSubmissions(), countPendingEvents()])
		: [0, 0];

	return {
		session,
		user,
		profile,
		role,
		isTournamentOrganizer: Boolean(profile?.is_tournament_organizer),
		flyoutEntries,
		pendingReviewCount,
		pendingEventCount
	};
};

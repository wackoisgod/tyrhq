import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listCommunityLinkGroups } from '$lib/server/community-links';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}
	if (role !== 'admin') {
		throw error(403, 'Admin role required');
	}

	const groups = await listCommunityLinkGroups();
	return { groups, supabaseConfigured: isSupabaseAdminConfigured() };
};

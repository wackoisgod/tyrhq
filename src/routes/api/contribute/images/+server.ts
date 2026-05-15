import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSharedUploads, listUploadsForUser } from '$lib/server/article-uploads';

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	// Contributors and admins share one community pool; regular users still
	// only see their own history. RLS already permits the elevated read; we
	// gate at the API layer because everything routes through the service-role
	// admin client.
	const uploads =
		role === 'contributor' || role === 'admin'
			? await listSharedUploads(120)
			: await listUploadsForUser(user.id, 60);
	return json({ uploads, scope: role === 'contributor' || role === 'admin' ? 'shared' : 'own' });
};

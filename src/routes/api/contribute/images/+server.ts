import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listUploadsForUser } from '$lib/server/article-uploads';

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const uploads = await listUploadsForUser(user.id, 60);
	return json({ uploads });
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { signArticleImageUpload, UploadValidationError } from '$lib/server/article-uploads';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	let body: { mime?: unknown; submissionId?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Expected JSON body.');
	}

	const declaredMime = typeof body.mime === 'string' ? body.mime : '';
	if (!declaredMime) error(400, 'Missing "mime" field.');

	if (typeof body.submissionId === 'string' && body.submissionId.length > 0) {
		if (!UUID_RE.test(body.submissionId)) error(400, 'submissionId must be a UUID.');
	}

	try {
		const ticket = await signArticleImageUpload({
			uploaderId: user.id,
			declaredMime
		});
		return json(ticket);
	} catch (err) {
		if (err instanceof UploadValidationError) error(err.statusCode, err.message);
		console.error('[api/contribute/images/sign] unexpected error', err);
		error(500, 'Could not start upload.');
	}
};

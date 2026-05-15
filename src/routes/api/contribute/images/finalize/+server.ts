import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finalizeArticleImageUpload, UploadValidationError } from '$lib/server/article-uploads';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	let body: { storagePath?: unknown; submissionId?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Expected JSON body.');
	}

	const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
	if (!storagePath) error(400, 'Missing "storagePath" field.');

	let submissionId: string | null = null;
	if (typeof body.submissionId === 'string' && body.submissionId.length > 0) {
		if (!UUID_RE.test(body.submissionId)) error(400, 'submissionId must be a UUID.');
		submissionId = body.submissionId;
	}

	try {
		const result = await finalizeArticleImageUpload({
			uploaderId: user.id,
			submissionId,
			storagePath
		});
		return json({
			url: result.url,
			width: result.width,
			height: result.height,
			byteSize: result.byteSize,
			mime: result.mime
		});
	} catch (err) {
		if (err instanceof UploadValidationError) error(err.statusCode, err.message);
		console.error('[api/contribute/images/finalize] unexpected error', err);
		error(500, 'Image upload failed.');
	}
};

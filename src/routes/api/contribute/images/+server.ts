import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listUploadsForUser,
	MAX_UPLOAD_BYTES,
	UploadValidationError,
	uploadArticleImage
} from '$lib/server/article-uploads';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const uploads = await listUploadsForUser(user.id, 60);
	return json({ uploads });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
		error(415, 'Expected multipart/form-data');
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, 'Could not parse upload body.');
	}

	const file = form.get('file');
	if (!(file instanceof File)) {
		error(400, 'Missing "file" field.');
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		error(413, `Image is too large. Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`);
	}

	const submissionIdRaw = form.get('submissionId');
	let submissionId: string | null = null;
	if (typeof submissionIdRaw === 'string' && submissionIdRaw.length > 0) {
		if (!UUID_RE.test(submissionIdRaw)) error(400, 'submissionId must be a UUID.');
		submissionId = submissionIdRaw;
	}

	const buffer = new Uint8Array(await file.arrayBuffer());

	try {
		const result = await uploadArticleImage({
			uploaderId: user.id,
			submissionId,
			bytes: buffer,
			declaredMime: file.type
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
		console.error('[api/contribute/images] unexpected upload error', err);
		error(500, 'Image upload failed.');
	}
};

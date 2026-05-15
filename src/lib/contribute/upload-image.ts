import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

export interface UploadedImage {
	url: string;
	width: number | null;
	height: number | null;
	byteSize: number;
	mime: string;
}

// Two-step upload: ask the server for a signed URL, PUT the bytes directly to
// Supabase Storage (bypassing the serverless function body cap), then call
// finalize so the server can validate and record the audit row.
export async function uploadArticleImage(
	file: File,
	opts: { submissionId?: string | null } = {}
): Promise<UploadedImage> {
	if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) {
		throw new Error('Image uploads are unavailable: Supabase is not configured.');
	}

	const signRes = await fetch('/api/contribute/images/sign', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			mime: file.type,
			submissionId: opts.submissionId ?? null
		})
	});
	if (!signRes.ok) {
		throw new Error((await signRes.text()) || `Upload setup failed (${signRes.status}).`);
	}
	const ticket = (await signRes.json()) as {
		storagePath: string;
		token: string;
		bucket: string;
		maxBytes: number;
	};

	if (file.size > ticket.maxBytes) {
		throw new Error(
			`Image is too large. Max ${(ticket.maxBytes / 1024 / 1024).toFixed(0)}MB.`
		);
	}

	const supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
	const { error: uploadError } = await supabase.storage
		.from(ticket.bucket)
		.uploadToSignedUrl(ticket.storagePath, ticket.token, file, {
			contentType: file.type,
			upsert: false
		});
	if (uploadError) {
		throw new Error(uploadError.message || 'Upload failed.');
	}

	const finalizeRes = await fetch('/api/contribute/images/finalize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			storagePath: ticket.storagePath,
			submissionId: opts.submissionId ?? null
		})
	});
	if (!finalizeRes.ok) {
		throw new Error((await finalizeRes.text()) || `Upload failed (${finalizeRes.status}).`);
	}
	return (await finalizeRes.json()) as UploadedImage;
}

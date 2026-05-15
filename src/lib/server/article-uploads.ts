import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from './supabase-admin';

// Keep this in sync with ARTICLE_IMAGE_BUCKET_PATH in content-sanitize.ts —
// `getArticleImageHostPrefix()` builds the public URL from the same name.
export const ARTICLE_IMAGE_BUCKET = 'article-images';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_DIMENSION = 4000;
export const MAX_UPLOADS_PER_DAY = 30;

const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXT_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export class UploadValidationError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'UploadValidationError';
		this.statusCode = statusCode;
	}
}

export interface ImageMetadata {
	mime: string;
	width: number | null;
	height: number | null;
}

/**
 * Sniff image format and dimensions from a file's leading bytes. We trust the
 * sniffed MIME over the browser-supplied one — a `.png` renamed from `.txt`
 * is rejected here. For JPEG/WebP we read what we can; if we can't determine
 * dimensions we return `null` and skip the dimension check (the byte-size
 * limit is the backstop).
 */
export function readImageMetadata(buf: Uint8Array): ImageMetadata | null {
	if (buf.length < 12) return null;
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	// PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 8 (length+'IHDR'+w+h)
	if (
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
	) {
		if (buf.length < 24) return { mime: 'image/png', width: null, height: null };
		return {
			mime: 'image/png',
			width: view.getUint32(16, false),
			height: view.getUint32(20, false)
		};
	}

	// JPEG: starts FF D8 FF
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		const dims = readJpegDimensions(buf, view);
		return { mime: 'image/jpeg', width: dims?.width ?? null, height: dims?.height ?? null };
	}

	// GIF87a / GIF89a — width/height at offset 6, little endian
	if (
		buf[0] === 0x47 &&
		buf[1] === 0x49 &&
		buf[2] === 0x46 &&
		buf[3] === 0x38 &&
		(buf[4] === 0x37 || buf[4] === 0x39) &&
		buf[5] === 0x61
	) {
		return {
			mime: 'image/gif',
			width: view.getUint16(6, true),
			height: view.getUint16(8, true)
		};
	}

	// WebP: 'RIFF' size 'WEBP' chunk
	if (
		buf[0] === 0x52 &&
		buf[1] === 0x49 &&
		buf[2] === 0x46 &&
		buf[3] === 0x46 &&
		buf[8] === 0x57 &&
		buf[9] === 0x45 &&
		buf[10] === 0x42 &&
		buf[11] === 0x50
	) {
		const dims = readWebpDimensions(buf, view);
		return { mime: 'image/webp', width: dims?.width ?? null, height: dims?.height ?? null };
	}

	return null;
}

function readJpegDimensions(
	buf: Uint8Array,
	view: DataView
): { width: number; height: number } | null {
	let i = 2;
	const end = buf.length;
	while (i < end - 8) {
		if (buf[i] !== 0xff) return null;
		let marker = buf[i + 1];
		while (marker === 0xff && i + 1 < end) {
			i++;
			marker = buf[i + 1];
		}
		i += 2;
		if (marker === 0xd8 || marker === 0xd9) continue;
		if (marker === 0xda) return null;
		const isSof =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;
		if (isSof) {
			if (i + 7 >= end) return null;
			return {
				height: view.getUint16(i + 3, false),
				width: view.getUint16(i + 5, false)
			};
		}
		if (i + 1 >= end) return null;
		const segLen = (buf[i] << 8) | buf[i + 1];
		if (segLen < 2) return null;
		i += segLen;
	}
	return null;
}

function readWebpDimensions(
	buf: Uint8Array,
	view: DataView
): { width: number; height: number } | null {
	if (buf.length < 30) return null;
	const chunkType = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
	if (chunkType === 'VP8X') {
		const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
		const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
		return { width: w, height: h };
	}
	if (chunkType === 'VP8 ') {
		return {
			width: view.getUint16(26, true) & 0x3fff,
			height: view.getUint16(28, true) & 0x3fff
		};
	}
	if (chunkType === 'VP8L') {
		if (buf.length < 25 || buf[20] !== 0x2f) return null;
		const b1 = buf[21];
		const b2 = buf[22];
		const b3 = buf[23];
		const b4 = buf[24];
		const w = (((b2 & 0x3f) << 8) | b1) + 1;
		const h = ((((b4 & 0xf) << 10) | (b3 << 2)) | ((b2 & 0xc0) >> 6)) + 1;
		return { width: w, height: h };
	}
	return null;
}

export interface UploadResult {
	url: string;
	storagePath: string;
	mime: string;
	width: number | null;
	height: number | null;
	byteSize: number;
}

export interface UploadListing {
	url: string;
	mime: string;
	width: number | null;
	height: number | null;
	byteSize: number;
	createdAt: string;
}

export async function listUploadsForUser(
	uploaderId: string,
	limit = 60
): Promise<UploadListing[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const { data, error } = await admin
		.from('article_uploads')
		.select('public_url, mime, width, height, byte_size, created_at')
		.eq('uploaded_by', uploaderId)
		.order('created_at', { ascending: false })
		.limit(Math.min(Math.max(1, limit), 200));

	if (error) {
		console.error('[article-uploads] listUploadsForUser failed', error);
		return [];
	}

	return ((data as Array<{
		public_url: string;
		mime: string;
		width: number | null;
		height: number | null;
		byte_size: number;
		created_at: string;
	}>) ?? []).map((row) => ({
		url: row.public_url,
		mime: row.mime,
		width: row.width,
		height: row.height,
		byteSize: row.byte_size,
		createdAt: row.created_at
	}));
}

export interface SignedUploadTicket {
	storagePath: string;
	token: string;
	signedUrl: string;
	bucket: string;
	expectedMime: string;
	maxBytes: number;
	publicUrl: string;
}

// Issue a signed upload URL so the browser can PUT bytes directly to Supabase
// Storage, bypassing the serverless function body cap. We pin the storage path
// to the uploader's ID prefix so finalize can verify ownership without trusting
// the client.
export async function signArticleImageUpload(params: {
	uploaderId: string;
	declaredMime: string;
}): Promise<SignedUploadTicket> {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new UploadValidationError(
			'Image uploads are unavailable: Supabase admin client is not configured.',
			500
		);
	}

	if (!SUPPORTED_MIME.has(params.declaredMime)) {
		throw new UploadValidationError(
			`Unsupported image type: ${params.declaredMime || '(none)'}`
		);
	}

	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const { count: recentCount, error: countError } = await admin
		.from('article_uploads')
		.select('id', { head: true, count: 'exact' })
		.eq('uploaded_by', params.uploaderId)
		.gte('created_at', since);
	if (countError) {
		console.error('[article-uploads] rate-limit check failed', countError);
		throw new UploadValidationError('Could not verify upload quota.', 500);
	}
	if ((recentCount ?? 0) >= MAX_UPLOADS_PER_DAY) {
		throw new UploadValidationError(
			`Upload limit reached (${MAX_UPLOADS_PER_DAY} per day). Try again later.`,
			429
		);
	}

	const now = new Date();
	const yyyy = String(now.getUTCFullYear());
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const ext = EXT_BY_MIME[params.declaredMime];
	const storagePath = `${params.uploaderId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;

	const { data, error: signError } = await admin.storage
		.from(ARTICLE_IMAGE_BUCKET)
		.createSignedUploadUrl(storagePath);

	if (signError || !data) {
		console.error('[article-uploads] signed-url creation failed', signError);
		throw new UploadValidationError('Could not start upload.', 500);
	}

	const { data: urlData } = admin.storage.from(ARTICLE_IMAGE_BUCKET).getPublicUrl(storagePath);

	return {
		storagePath,
		token: data.token,
		signedUrl: data.signedUrl,
		bucket: ARTICLE_IMAGE_BUCKET,
		expectedMime: params.declaredMime,
		maxBytes: MAX_UPLOAD_BYTES,
		publicUrl: urlData.publicUrl
	};
}

// Validate a client-uploaded object and write its audit row. The uploader-ID
// prefix in `storagePath` is checked so callers can't finalize another user's
// uploads. On any validation failure we delete the orphan.
export async function finalizeArticleImageUpload(params: {
	uploaderId: string;
	submissionId?: string | null;
	storagePath: string;
}): Promise<UploadResult> {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new UploadValidationError(
			'Image uploads are unavailable: Supabase admin client is not configured.',
			500
		);
	}

	const expectedPrefix = `${params.uploaderId}/`;
	if (!params.storagePath.startsWith(expectedPrefix) || params.storagePath.includes('..')) {
		throw new UploadValidationError('Invalid storage path.', 403);
	}

	const { data: blob, error: downloadError } = await admin.storage
		.from(ARTICLE_IMAGE_BUCKET)
		.download(params.storagePath);
	if (downloadError || !blob) {
		throw new UploadValidationError('Uploaded file not found.', 404);
	}

	const bytes = new Uint8Array(await blob.arrayBuffer());

	const cleanup = async (reason: string, code = 400) => {
		const { error: removeError } = await admin.storage
			.from(ARTICLE_IMAGE_BUCKET)
			.remove([params.storagePath]);
		if (removeError) {
			console.error('[article-uploads] orphan cleanup failed', removeError);
		}
		throw new UploadValidationError(reason, code);
	};

	if (bytes.byteLength === 0) {
		await cleanup('Empty file.');
	}
	if (bytes.byteLength > MAX_UPLOAD_BYTES) {
		await cleanup(`Image is too large. Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`, 413);
	}

	const meta = readImageMetadata(bytes);
	if (!meta) {
		await cleanup('Unrecognised image format. Allowed: PNG, JPEG, WebP, GIF.');
	}
	if (!SUPPORTED_MIME.has(meta!.mime)) {
		await cleanup(`Unsupported image type: ${meta!.mime}`);
	}
	// The path extension was chosen from the declared MIME at sign time, so a
	// mismatch here means the client uploaded different content than they
	// promised — reject and clean up.
	const expectedExt = params.storagePath.split('.').pop();
	if (expectedExt !== EXT_BY_MIME[meta!.mime]) {
		await cleanup(
			`Uploaded content (${meta!.mime}) doesn't match the requested type.`
		);
	}
	if (
		(meta!.width !== null && meta!.width > MAX_UPLOAD_DIMENSION) ||
		(meta!.height !== null && meta!.height > MAX_UPLOAD_DIMENSION)
	) {
		await cleanup(`Image dimensions exceed ${MAX_UPLOAD_DIMENSION}px on a side.`);
	}

	const { data: urlData } = admin.storage
		.from(ARTICLE_IMAGE_BUCKET)
		.getPublicUrl(params.storagePath);
	const publicUrl = urlData.publicUrl;

	const { error: insertError } = await admin.from('article_uploads').insert({
		uploaded_by: params.uploaderId,
		submission_id: params.submissionId ?? null,
		storage_path: `${ARTICLE_IMAGE_BUCKET}/${params.storagePath}`,
		public_url: publicUrl,
		mime: meta!.mime,
		byte_size: bytes.byteLength,
		width: meta!.width,
		height: meta!.height
	});
	if (insertError) {
		// Storage write succeeded but audit row failed — log & continue. The
		// image is still usable; orphan-cleanup is out of scope for v1.
		console.error('[article-uploads] audit row insert failed', insertError);
	}

	return {
		url: publicUrl,
		storagePath: params.storagePath,
		mime: meta!.mime,
		width: meta!.width,
		height: meta!.height,
		byteSize: bytes.byteLength
	};
}

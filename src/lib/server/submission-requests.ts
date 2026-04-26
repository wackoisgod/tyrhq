import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { ContentValidationError } from './content-sanitize';
import { SubmissionStateError } from './submissions';

export const submissionDraftSchema = z
	.object({
		id: z.string().uuid().optional(),
		type: z.enum(['guide', 'article']),
		title: z.string().max(400),
		summary: z.string().max(1000).nullable().optional(),
		slug: z.string().max(100).nullable().optional(),
		bodyMarkdown: z.string().max(60_000),
		tags: z.array(z.string()).max(20).optional(),
		vehicleSlugs: z.array(z.string()).max(20).nullable().optional(),
		parentArticleId: z.string().uuid().nullable().optional()
	})
	.strict();

export type SubmissionDraftBody = z.infer<typeof submissionDraftSchema>;

export const previewBodySchema = z
	.object({
		bodyMarkdown: z.string().max(60_000)
	})
	.strict();

export const decisionBodySchema = z
	.object({
		decision: z.enum(['approve', 'changes_requested', 'reject']),
		notes: z.string().max(2000).nullable().optional()
	})
	.strict();

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
		error(400, `${path}${issue?.message ?? 'Invalid request body'}`);
	}
	return parsed.data;
}

/**
 * Translate sanitiser/state-machine errors into a JSON-friendly shape that
 * SvelteKit's `error()` can serialise. Always throws.
 */
export function rethrowAsHttp(err: unknown): never {
	if (err instanceof ContentValidationError) {
		error(422, `${err.field}: ${err.message}`);
	}
	if (err instanceof SubmissionStateError) {
		error(err.statusCode, err.message);
	}
	throw err;
}

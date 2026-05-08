import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { ContentValidationError } from './content-sanitize';
import { SubmissionStateError } from './submissions';
import { FLYOUT_SECTIONS } from '$lib/content/flyout-sections';

const flyoutSectionSchema = z.enum(FLYOUT_SECTIONS).nullable().optional();

export const submissionDraftSchema = z
	.object({
		id: z.string().uuid().optional(),
		type: z.enum(['guide', 'article', 'patch']),
		title: z.string().max(400),
		summary: z.string().max(1000).nullable().optional(),
		slug: z.string().max(100).nullable().optional(),
		bodyMarkdown: z.string().max(60_000),
		tags: z.array(z.string()).max(20).optional(),
		vehicleSlugs: z.array(z.string()).max(20).nullable().optional(),
		parentArticleId: z.string().uuid().nullable().optional(),
		flyoutSection: flyoutSectionSchema,
		// Full https URL of an uploaded image. The bucket-prefix check happens
		// in `assertHeroImageUrl` once we have the env-derived prefix; we just
		// shape-check here.
		heroImageUrl: z.string().url().max(1024).nullable().optional(),
		// Display label for patch notes (e.g. "v0.5.2"). Ignored for other types.
		version: z.string().max(40).nullable().optional()
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
		notes: z.string().max(2000).nullable().optional(),
		// Admin-only: override the contributor's proposed flyout section and
		// set a sort priority within that section. Ignored unless decision is
		// "approve". Order may be negative for stable ordering.
		flyoutSection: flyoutSectionSchema,
		flyoutOrder: z.number().int().min(-10_000).max(10_000).nullable().optional(),
		// Optimistic-concurrency guard: the content_hash the reviewer was
		// looking at when they made the call. If the contributor edited the
		// pending submission in the meantime, the hash on the row will differ
		// and the decision is rejected so the reviewer can re-read.
		expectedContentHash: z.string().max(128).nullable().optional()
	})
	.strict();

export const flyoutAssignmentBodySchema = z
	.object({
		flyoutSection: flyoutSectionSchema,
		flyoutOrder: z.number().int().min(-10_000).max(10_000).nullable().optional(),
		isPinned: z.boolean().optional()
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

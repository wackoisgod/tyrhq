import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { CommunityLinkError } from './community-links';

// Shape-level checks only — semantic rules (trimmed lengths, https links) live
// in validateGroupInput / validateLinkInput so the limits stay in one place.
// The zod maxima here are deliberately looser and just bound payload size.
export const groupBodySchema = z
	.object({
		heading: z.string().max(400),
		annotation: z.string().max(200).nullable().optional()
	})
	.strict();

export type GroupBody = z.infer<typeof groupBodySchema>;

export const linkCreateBodySchema = z
	.object({
		groupId: z.string().uuid(),
		label: z.string().max(400),
		href: z.string().max(2048),
		description: z.string().max(1000).nullable().optional(),
		tag: z.string().max(100).nullable().optional()
	})
	.strict();

export type LinkCreateBody = z.infer<typeof linkCreateBodySchema>;

/** Same as the create body without `groupId` — links don't change group. */
export const linkUpdateBodySchema = linkCreateBodySchema.omit({ groupId: true }).strict();

export type LinkUpdateBody = z.infer<typeof linkUpdateBodySchema>;

export const moveBodySchema = z
	.object({
		direction: z.enum(['up', 'down'])
	})
	.strict();

export type MoveBody = z.infer<typeof moveBodySchema>;

export function validateGroupBody(body: unknown) {
	return groupBodySchema.safeParse(body);
}

export function validateLinkCreateBody(body: unknown) {
	return linkCreateBodySchema.safeParse(body);
}

export function validateLinkUpdateBody(body: unknown) {
	return linkUpdateBodySchema.safeParse(body);
}

export function validateMoveBody(body: unknown) {
	return moveBodySchema.safeParse(body);
}

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

/** Translate community-link errors into SvelteKit HTTP errors. Always throws. */
export function rethrowAsHttp(err: unknown): never {
	if (err instanceof CommunityLinkError) {
		error(err.statusCode, err.message);
	}
	throw err;
}

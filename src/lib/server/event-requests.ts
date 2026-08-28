import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { CommunityEventError } from './events';

// Shape-level checks only — semantic rules (date windows, https links, trimmed
// lengths) live in validateEventInput so the limits stay in one place. The
// zod maxima here are deliberately looser and just bound payload size.
export const eventCreateBodySchema = z
	.object({
		title: z.string().max(400),
		description: z.string().max(4000).nullable().optional(),
		location: z.string().max(400).nullable().optional(),
		url: z.string().max(2048).nullable().optional(),
		startsAt: z.string().max(64),
		endsAt: z.string().max(64).nullable().optional()
	})
	.strict();

export type EventCreateBody = z.infer<typeof eventCreateBodySchema>;

export const eventDecisionBodySchema = z
	.object({
		decision: z.enum(['approve', 'reject']),
		notes: z.string().max(2000).nullable().optional()
	})
	.strict();

export type EventDecisionBody = z.infer<typeof eventDecisionBodySchema>;

export function validateEventCreateBody(body: unknown) {
	return eventCreateBodySchema.safeParse(body);
}

export function validateEventDecisionBody(body: unknown) {
	return eventDecisionBodySchema.safeParse(body);
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

/**
 * Translate event-layer errors into SvelteKit HTTP errors. Always throws.
 */
export function rethrowAsHttp(err: unknown): never {
	if (err instanceof CommunityEventError) {
		error(err.statusCode, err.message);
	}
	throw err;
}

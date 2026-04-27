import { error } from '@sveltejs/kit';
import { z } from 'zod';

export const toggleArticleStarBodySchema = z
	.object({
		articleId: z.string().uuid('articleId must be a valid UUID')
	})
	.strict();

export type ToggleArticleStarBody = z.infer<typeof toggleArticleStarBodySchema>;

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

export function validateToggleArticleStarBody(body: unknown) {
	return toggleArticleStarBodySchema.safeParse(body);
}

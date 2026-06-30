import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSubmissionById } from '$lib/server/submissions';
import { getArticleByIdForReview } from '$lib/server/articles';
import { sanitizeArticleBody } from '$lib/server/content-sanitize';
import { renderGameStatRefs } from '$lib/server/game-data-refs';
import { computeArticleDiff } from '$lib/server/article-diff';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}
	if (role !== 'contributor' && role !== 'admin') {
		throw error(403, 'Reviewer role required');
	}

	const submission = await getSubmissionById(params.id);
	if (!submission) throw error(404, 'Submission not found');

	// Re-render server-side from the canonical markdown so reviewers see the
	// exact same output the publish pipeline will produce.
	let renderedHtml = submission.body_html;
	let renderError: string | null = null;
	try {
		const result = await sanitizeArticleBody(submission.body_markdown);
		renderedHtml = renderGameStatRefs(result.html);
	} catch (err) {
		renderError = err instanceof Error ? err.message : String(err);
	}

	const parentArticle = submission.parent_article_id
		? await getArticleByIdForReview(submission.parent_article_id)
		: null;

	const diff = parentArticle ? computeArticleDiff(parentArticle, submission) : null;

	const isOwnSubmission = submission.submitter_id === user.id;
	const canApprove = !isOwnSubmission || role === 'admin';

	return {
		submission,
		renderedHtml,
		renderError,
		parentArticle,
		diff,
		canApprove,
		isOwnSubmission,
		role
	};
};

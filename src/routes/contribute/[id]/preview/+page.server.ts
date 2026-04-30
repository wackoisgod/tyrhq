import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSubmissionById } from '$lib/server/submissions';
import { sanitizeArticleBody } from '$lib/server/content-sanitize';
import { getGameSnapshot } from '$lib/data/game-data';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}

	const submission = await getSubmissionById(params.id);
	if (!submission) throw error(404, 'Submission not found');

	const isOwner = submission.submitter_id === user.id;
	const isReviewer = role === 'contributor' || role === 'admin';
	if (!isOwner && !isReviewer) {
		throw error(403, 'You can only preview your own submissions.');
	}

	// Re-render from canonical markdown so the preview matches what the
	// publish pipeline will produce. Body sanitization can fail on draft
	// content (too short, malformed directive) — we still render the page so
	// the contributor can see the failure inline.
	let bodyHtml = submission.body_html ?? '';
	let renderError: string | null = null;
	try {
		const result = await sanitizeArticleBody(submission.body_markdown);
		bodyHtml = result.html;
	} catch (err) {
		renderError = err instanceof Error ? err.message : String(err);
	}

	// Resolve the contributor's display name so the byline matches what will
	// appear after approval.
	let authorDisplay: string | null = null;
	if (locals.supabase) {
		const { data: profile } = await locals.supabase
			.from('profiles')
			.select('display_name')
			.eq('id', submission.submitter_id)
			.maybeSingle<{ display_name: string | null }>();
		authorDisplay = profile?.display_name?.trim() || null;
	}

	const tankBySlug = new Map(getGameSnapshot().tanks.map((t) => [t.slug, t]));
	const vehicles = (submission.vehicle_slugs ?? [])
		.map((slug) => tankBySlug.get(slug))
		.filter((t): t is NonNullable<typeof t> => Boolean(t))
		.map((t) => ({ slug: t.slug, name: t.name }));

	return {
		submission: {
			id: submission.id,
			type: submission.type,
			title: submission.title || '(Untitled)',
			summary: submission.summary,
			tags: submission.tags ?? [],
			updatedAt: submission.updated_at,
			authorDisplay,
			bodyHtml,
			heroImageUrl: submission.hero_image_url
		},
		vehicles,
		renderError
	};
};

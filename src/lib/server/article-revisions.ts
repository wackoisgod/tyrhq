import { getSupabaseAdminClient } from './supabase-admin';
import { computeArticleDiff, type ArticleDiff } from './article-diff';
import type { ArticleDetail, ArticleType } from './articles';

export interface ArticleContributor {
	userId: string;
	displayName: string | null;
	contributionCount: number;
	firstContributedAt: string;
	lastContributedAt: string;
}

export interface ArticleRevisionSummary {
	id: string;
	articleId: string;
	createdAt: string;
	submitterUserId: string | null;
	submitterDisplay: string | null;
	createdBy: string | null;
	title: string;
	summary: string | null;
	sourceSubmissionId: string | null;
}

export interface ArticleRevisionDetail extends ArticleRevisionSummary {
	bodyMarkdown: string;
	bodyHtml: string;
	tags: string[];
	vehicleSlugs: string[] | null;
	authorDisplay: string | null;
	heroImageUrl: string | null;
}

export interface RevisionDiff {
	revision: ArticleRevisionDetail;
	previous: ArticleRevisionDetail | null;
	diff: ArticleDiff;
}

interface ContributorRow {
	article_id: string;
	user_id: string;
	display_name: string | null;
	contribution_count: number;
	first_contributed_at: string;
	last_contributed_at: string;
}

interface RevisionRow {
	id: string;
	article_id: string;
	source_submission_id: string | null;
	title: string;
	summary: string | null;
	body_markdown: string;
	body_html: string;
	tags: string[] | null;
	vehicle_slugs: string[] | null;
	author_display: string | null;
	submitter_user_id: string | null;
	submitter_display: string | null;
	created_by: string | null;
	created_at: string;
	hero_image_url: string | null;
}

const REVISION_SUMMARY_COLUMNS =
	'id, article_id, source_submission_id, title, summary, submitter_user_id, submitter_display, created_by, created_at';
const REVISION_DETAIL_COLUMNS = `${REVISION_SUMMARY_COLUMNS}, body_markdown, body_html, tags, vehicle_slugs, author_display, hero_image_url`;

function summaryFromRow(row: RevisionRow): ArticleRevisionSummary {
	return {
		id: row.id,
		articleId: row.article_id,
		createdAt: row.created_at,
		submitterUserId: row.submitter_user_id,
		submitterDisplay: row.submitter_display,
		createdBy: row.created_by,
		title: row.title,
		summary: row.summary,
		sourceSubmissionId: row.source_submission_id
	};
}

function detailFromRow(row: RevisionRow): ArticleRevisionDetail {
	return {
		...summaryFromRow(row),
		bodyMarkdown: row.body_markdown,
		bodyHtml: row.body_html,
		tags: row.tags ?? [],
		vehicleSlugs: row.vehicle_slugs,
		authorDisplay: row.author_display,
		heroImageUrl: row.hero_image_url
	};
}

/**
 * Distinct edit-contributors for an article, ordered by most recent
 * contribution. Excludes the article's primary author (that credit lives in
 * the byline). Returns [] when the admin client is unavailable so callers
 * can render the page without contributor info.
 */
export async function listArticleContributors(articleId: string): Promise<ArticleContributor[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const { data, error } = await admin
		.from('article_contributors')
		.select('article_id, user_id, display_name, contribution_count, first_contributed_at, last_contributed_at')
		.eq('article_id', articleId)
		.order('last_contributed_at', { ascending: false });

	if (error) {
		// View may not exist yet (pre-migration); soft-fail.
		console.error('[article-revisions] listArticleContributors failed', error);
		return [];
	}

	return ((data ?? []) as ContributorRow[]).map((row) => ({
		userId: row.user_id,
		displayName: row.display_name,
		contributionCount: row.contribution_count,
		firstContributedAt: row.first_contributed_at,
		lastContributedAt: row.last_contributed_at
	}));
}

/**
 * All published revisions of an article, newest first. Powers the per-article
 * history page. Returns [] if the admin client is unavailable.
 */
export async function listRevisionsForArticle(
	articleId: string
): Promise<ArticleRevisionSummary[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const { data, error } = await admin
		.from('article_revisions')
		.select(REVISION_SUMMARY_COLUMNS)
		.eq('article_id', articleId)
		.order('created_at', { ascending: false });

	if (error) {
		console.error('[article-revisions] listRevisionsForArticle failed', error);
		return [];
	}

	return ((data ?? []) as RevisionRow[]).map(summaryFromRow);
}

/**
 * Count of approved revisions a user has submitted on articles they did NOT
 * author. Mirrors the article_contributors view's exclusion rule so the
 * settings stat matches what's displayed publicly.
 */
export async function countContributionsByUser(userId: string): Promise<number> {
	const admin = getSupabaseAdminClient();
	if (!admin) return 0;

	const { data, error } = await admin
		.from('article_revisions')
		.select('article_id, articles!inner(author_user_id)')
		.eq('submitter_user_id', userId)
		.neq('articles.author_user_id', userId);

	if (error) {
		console.error('[article-revisions] countContributionsByUser failed', error);
		return 0;
	}

	return data?.length ?? 0;
}

/**
 * Load a single revision plus the one immediately preceding it on the same
 * article (by created_at). Used to render a diff view at
 * /articles/[slug]/history/[revisionId]. Returns null if the revision doesn't
 * exist or doesn't belong to the requested article.
 */
export async function getArticleRevisionDiff(
	articleId: string,
	revisionId: string
): Promise<RevisionDiff | null> {
	const admin = getSupabaseAdminClient();
	if (!admin) return null;

	const { data: target, error: targetError } = await admin
		.from('article_revisions')
		.select(REVISION_DETAIL_COLUMNS)
		.eq('id', revisionId)
		.eq('article_id', articleId)
		.maybeSingle<RevisionRow>();

	if (targetError) {
		console.error('[article-revisions] getArticleRevisionDiff target lookup failed', targetError);
		return null;
	}
	if (!target) return null;

	const { data: prior, error: priorError } = await admin
		.from('article_revisions')
		.select(REVISION_DETAIL_COLUMNS)
		.eq('article_id', articleId)
		.lt('created_at', target.created_at)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle<RevisionRow>();

	if (priorError) {
		console.error('[article-revisions] getArticleRevisionDiff prior lookup failed', priorError);
	}

	const revision = detailFromRow(target);
	const previous = prior ? detailFromRow(prior) : null;

	const parent: ArticleDetail = {
		id: revision.articleId,
		type: 'article' as ArticleType,
		slug: '',
		title: previous?.title ?? '',
		summary: previous?.summary ?? null,
		authorDisplay: previous?.authorDisplay ?? null,
		authorUserId: null,
		tags: previous?.tags ?? [],
		vehicleSlugs: previous?.vehicleSlugs ?? null,
		starCount: 0,
		publishedAt: previous?.createdAt ?? revision.createdAt,
		updatedAt: previous?.createdAt ?? revision.createdAt,
		isNew: false,
		flyoutSection: null,
		flyoutOrder: null,
		heroImageUrl: previous?.heroImageUrl ?? null,
		version: null,
		isPinned: false,
		bodyMarkdown: previous?.bodyMarkdown ?? '',
		bodyHtml: previous?.bodyHtml ?? '',
		currentRevisionId: null
	};

	const submission = {
		id: revision.id,
		type: 'article' as const,
		parent_article_id: revision.articleId,
		submitter_id: revision.submitterUserId ?? '',
		title: revision.title,
		summary: revision.summary,
		slug: null,
		body_markdown: revision.bodyMarkdown,
		body_html: revision.bodyHtml,
		tags: revision.tags,
		vehicle_slugs: revision.vehicleSlugs,
		status: 'published' as const,
		reviewer_id: revision.createdBy,
		review_notes: null,
		content_hash: null,
		created_at: revision.createdAt,
		updated_at: revision.createdAt,
		submitted_at: null,
		decided_at: null,
		flyout_section: null,
		flyout_order: null,
		hero_image_url: revision.heroImageUrl,
		version: null
	};

	const diff = computeArticleDiff(parent, submission);

	return { revision, previous, diff };
}

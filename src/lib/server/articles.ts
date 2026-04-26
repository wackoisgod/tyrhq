import { getSupabaseAdminClient } from './supabase-admin';

export type ArticleType = 'guide' | 'article';

export interface ArticleSummary {
	id: string;
	type: ArticleType;
	slug: string;
	title: string;
	summary: string | null;
	authorDisplay: string | null;
	authorUserId: string | null;
	tags: string[];
	vehicleSlugs: string[] | null;
	publishedAt: string;
	updatedAt: string;
}

export interface ArticleDetail extends ArticleSummary {
	bodyMarkdown: string;
	bodyHtml: string;
	currentRevisionId: string | null;
}

interface ArticleRow {
	id: string;
	type: ArticleType;
	slug: string;
	title: string;
	summary: string | null;
	body_markdown: string;
	body_html: string;
	author_display: string | null;
	author_user_id: string | null;
	tags: string[] | null;
	vehicle_slugs: string[] | null;
	published_at: string | null;
	updated_at: string;
	current_revision_id: string | null;
}

const SUMMARY_COLUMNS =
	'id, type, slug, title, summary, author_display, author_user_id, tags, vehicle_slugs, published_at, updated_at';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, body_markdown, body_html, current_revision_id`;

function summaryFromRow(row: ArticleRow): ArticleSummary {
	return {
		id: row.id,
		type: row.type,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		authorDisplay: row.author_display,
		authorUserId: row.author_user_id,
		tags: row.tags ?? [],
		vehicleSlugs: row.vehicle_slugs,
		publishedAt: row.published_at ?? row.updated_at,
		updatedAt: row.updated_at
	};
}

function detailFromRow(row: ArticleRow): ArticleDetail {
	return {
		...summaryFromRow(row),
		bodyMarkdown: row.body_markdown,
		bodyHtml: row.body_html,
		currentRevisionId: row.current_revision_id
	};
}

function requireAdmin() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new Error(
			'Article store is unavailable: Supabase admin client is not configured (set SUPABASE_SERVICE_ROLE_KEY).'
		);
	}
	return admin;
}

export async function listPublishedArticles(type: ArticleType): Promise<ArticleSummary[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const { data, error } = await admin
		.from('articles')
		.select(SUMMARY_COLUMNS)
		.eq('type', type)
		.eq('status', 'published')
		.order('published_at', { ascending: false });

	if (error) {
		console.error('[articles] listPublishedArticles failed', error);
		return [];
	}

	return ((data as ArticleRow[]) ?? []).map(summaryFromRow);
}

export async function getPublishedArticle(
	type: ArticleType,
	slug: string
): Promise<ArticleDetail | null> {
	const admin = getSupabaseAdminClient();
	if (!admin) return null;

	const { data, error } = await admin
		.from('articles')
		.select(DETAIL_COLUMNS)
		.eq('type', type)
		.eq('slug', slug)
		.eq('status', 'published')
		.maybeSingle<ArticleRow>();

	if (error) {
		console.error('[articles] getPublishedArticle failed', error);
		return null;
	}

	return data ? detailFromRow(data) : null;
}

export async function getArticleByIdForReview(id: string): Promise<ArticleDetail | null> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('articles')
		.select(DETAIL_COLUMNS)
		.eq('id', id)
		.maybeSingle<ArticleRow>();
	if (error) {
		console.error('[articles] getArticleByIdForReview failed', error);
		return null;
	}
	return data ? detailFromRow(data) : null;
}

export interface ArticleAdminRow extends ArticleSummary {
	status: 'draft' | 'published' | 'withdrawn';
}

/**
 * Admin-only listing of every article regardless of status. Used by
 * /admin/articles so admins can see withdrawn rows to restore them.
 */
export async function listAllArticlesForAdmin(): Promise<ArticleAdminRow[]> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('articles')
		.select(`${SUMMARY_COLUMNS}, status`)
		.order('updated_at', { ascending: false });
	if (error) {
		console.error('[articles] listAllArticlesForAdmin failed', error);
		return [];
	}
	return ((data as (ArticleRow & { status: 'draft' | 'published' | 'withdrawn' })[]) ?? []).map(
		(row) => ({
			...summaryFromRow(row),
			status: row.status
		})
	);
}

/**
 * Has any article (in any status, any type) ever taken this slug? Used during
 * submission validation to prevent two contributors picking the same slug.
 * Pending submissions are checked separately in the submissions service.
 */
export async function isSlugTaken(
	type: ArticleType,
	slug: string,
	exceptArticleId?: string
): Promise<boolean> {
	const admin = requireAdmin();
	let query = admin.from('articles').select('id').eq('type', type).eq('slug', slug).limit(1);
	if (exceptArticleId) query = query.neq('id', exceptArticleId);
	const { data, error } = await query;
	if (error) {
		console.error('[articles] isSlugTaken failed', error);
		throw new Error('Could not verify slug uniqueness');
	}
	return (data?.length ?? 0) > 0;
}

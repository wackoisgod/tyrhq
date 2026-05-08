import { getSupabaseAdminClient } from './supabase-admin';
import type { FlyoutSection } from '$lib/content/flyout-sections';
import { isRecentlyPublished } from '$lib/utils/article-recency';

export type ArticleType = 'guide' | 'article' | 'patch';

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
	starCount: number;
	publishedAt: string;
	updatedAt: string;
	isNew: boolean;
	flyoutSection: FlyoutSection | null;
	flyoutOrder: number | null;
	heroImageUrl: string | null;
	version: string | null;
	isPinned: boolean;
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
	author_profile:
		| {
				display_name: string | null;
		  }
		| {
				display_name: string | null;
		  }[]
		| null;
	tags: string[] | null;
	vehicle_slugs: string[] | null;
	star_count: number;
	published_at: string | null;
	updated_at: string;
	current_revision_id: string | null;
	flyout_section: string | null;
	flyout_order: number | null;
	hero_image_url: string | null;
	version: string | null;
	is_pinned?: boolean | null;
}

const SUMMARY_COLUMNS_BASE =
	'id, type, slug, title, summary, author_display, author_user_id, author_profile:profiles(display_name), tags, vehicle_slugs, star_count, published_at, updated_at, flyout_section, flyout_order, hero_image_url, version';
const SUMMARY_COLUMNS = `${SUMMARY_COLUMNS_BASE}, is_pinned`;
const DETAIL_COLUMNS_BASE = `${SUMMARY_COLUMNS_BASE}, body_markdown, body_html, current_revision_id`;
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, body_markdown, body_html, current_revision_id`;

function isMissingPinnedColumn(error: { code?: string; message?: string } | null): boolean {
	return Boolean(error && error.code === '42703' && error.message?.includes('is_pinned'));
}

function withPinnedDefault(row: ArticleRow): ArticleRow {
	return {
		...row,
		is_pinned: row.is_pinned ?? false
	};
}

function resolveAuthorDisplay(row: ArticleRow): string | null {
	if (row.author_display) return row.author_display;
	if (Array.isArray(row.author_profile)) return row.author_profile[0]?.display_name ?? null;
	return row.author_profile?.display_name ?? null;
}

function summaryFromRow(row: ArticleRow): ArticleSummary {
	const publishedAt = row.published_at ?? row.updated_at;
	return {
		id: row.id,
		type: row.type,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		authorDisplay: resolveAuthorDisplay(row),
		authorUserId: row.author_user_id,
		tags: row.tags ?? [],
		vehicleSlugs: row.vehicle_slugs,
		starCount: row.star_count,
		publishedAt,
		updatedAt: row.updated_at,
		isNew: isRecentlyPublished(publishedAt),
		flyoutSection: row.flyout_section as FlyoutSection | null,
		flyoutOrder: row.flyout_order,
		heroImageUrl: row.hero_image_url,
		version: row.version,
		isPinned: row.is_pinned ?? false
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

	let data: ArticleRow[] | null = null;
	let error: { code?: string; message?: string } | null = null;

	const result = await admin
		.from('articles')
		.select(SUMMARY_COLUMNS)
		.eq('type', type)
		.eq('status', 'published')
		.order('published_at', { ascending: false });
	data = result.data as ArticleRow[] | null;
	error = result.error;

	if (isMissingPinnedColumn(error)) {
		const legacy = await admin
			.from('articles')
			.select(SUMMARY_COLUMNS_BASE)
			.eq('type', type)
			.eq('status', 'published')
			.order('published_at', { ascending: false });
		data = legacy.data as ArticleRow[] | null;
		error = legacy.error;
	}

	if (error) {
		console.error('[articles] listPublishedArticles failed', error);
		return [];
	}

	return (data ?? []).map(withPinnedDefault).map(summaryFromRow);
}

export async function getPublishedArticle(
	type: ArticleType,
	slug: string
): Promise<ArticleDetail | null> {
	const admin = getSupabaseAdminClient();
	if (!admin) return null;

	let data: ArticleRow | null = null;
	let error: { code?: string; message?: string } | null = null;

	const result = await admin
		.from('articles')
		.select(DETAIL_COLUMNS)
		.eq('type', type)
		.eq('slug', slug)
		.eq('status', 'published')
		.maybeSingle<ArticleRow>();
	data = result.data;
	error = result.error;

	if (isMissingPinnedColumn(error)) {
		const legacy = await admin
			.from('articles')
			.select(DETAIL_COLUMNS_BASE)
			.eq('type', type)
			.eq('slug', slug)
			.eq('status', 'published')
			.maybeSingle<ArticleRow>();
		data = legacy.data;
		error = legacy.error;
	}

	if (error) {
		console.error('[articles] getPublishedArticle failed', error);
		return null;
	}

	return data ? detailFromRow(withPinnedDefault(data)) : null;
}

export async function getArticleByIdForReview(id: string): Promise<ArticleDetail | null> {
	const admin = requireAdmin();
	let data: ArticleRow | null = null;
	let error: { code?: string; message?: string } | null = null;

	const result = await admin
		.from('articles')
		.select(DETAIL_COLUMNS)
		.eq('id', id)
		.maybeSingle<ArticleRow>();
	data = result.data;
	error = result.error;

	if (isMissingPinnedColumn(error)) {
		const legacy = await admin
			.from('articles')
			.select(DETAIL_COLUMNS_BASE)
			.eq('id', id)
			.maybeSingle<ArticleRow>();
		data = legacy.data;
		error = legacy.error;
	}
	if (error) {
		console.error('[articles] getArticleByIdForReview failed', error);
		return null;
	}
	return data ? detailFromRow(withPinnedDefault(data)) : null;
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
	type ArticleAdminRawRow = ArticleRow & { status: 'draft' | 'published' | 'withdrawn' };
	let data: ArticleAdminRawRow[] | null = null;
	let error: { code?: string; message?: string } | null = null;

	const result = await admin
		.from('articles')
		.select(`${SUMMARY_COLUMNS}, status`)
		.order('updated_at', { ascending: false });
	data = result.data as ArticleAdminRawRow[] | null;
	error = result.error;

	if (isMissingPinnedColumn(error)) {
		const legacy = await admin
			.from('articles')
			.select(`${SUMMARY_COLUMNS_BASE}, status`)
			.order('updated_at', { ascending: false });
		data = legacy.data as ArticleAdminRawRow[] | null;
		error = legacy.error;
	}
	if (error) {
		console.error('[articles] listAllArticlesForAdmin failed', error);
		return [];
	}
	return (data ?? []).map((row) => ({
		...summaryFromRow(withPinnedDefault(row)),
		status: row.status
	}));
}

export interface FlyoutEntry {
	section: FlyoutSection;
	href: string;
	label: string;
	order: number | null;
}

/**
 * Returns every published guide/article that an admin has assigned a flyout
 * section to. Consumed by the layout server load to build the Resources
 * mega-menu — expect <50 rows in practice.
 */
export async function listFlyoutEntries(): Promise<FlyoutEntry[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const { data, error } = await admin
		.from('articles')
		.select('type, slug, title, flyout_section, flyout_order')
		.eq('status', 'published')
		.not('flyout_section', 'is', null)
		.order('flyout_section', { ascending: true })
		.order('flyout_order', { ascending: true, nullsFirst: false })
		.order('title', { ascending: true });

	if (error) {
		console.error('[articles] listFlyoutEntries failed', error);
		return [];
	}

	return ((data ?? []) as Array<{
		type: ArticleType;
		slug: string;
		title: string;
		flyout_section: string;
		flyout_order: number | null;
	}>).map((row) => ({
		section: row.flyout_section as FlyoutSection,
		href: `${typeRoot(row.type)}/${row.slug}`,
		label: row.title,
		order: row.flyout_order
	}));
}

function typeRoot(type: ArticleType): string {
	if (type === 'guide') return '/guides';
	if (type === 'patch') return '/patch-notes';
	return '/articles';
}

export interface FlyoutAssignmentInput {
	flyoutSection: FlyoutSection | null;
	flyoutOrder: number | null;
	isPinned?: boolean;
}

/**
 * Update only the flyout assignment fields on an article. Used by the admin
 * post-publication editor on /admin/articles. Does not touch revision history
 * — flyout placement is editorial nav metadata, not versioned content.
 */
export async function updateArticleFlyoutAssignment(
	articleId: string,
	input: FlyoutAssignmentInput
): Promise<void> {
	const admin = requireAdmin();
	const update: {
		flyout_section: FlyoutSection | null;
		flyout_order: number | null;
		is_pinned?: boolean;
	} = {
		flyout_section: input.flyoutSection,
		flyout_order: input.flyoutSection ? input.flyoutOrder : null
	};
	if (input.isPinned !== undefined) {
		update.is_pinned = input.isPinned;
	}

	const { error } = await admin
		.from('articles')
		.update(update)
		.eq('id', articleId);
	if (error) {
		console.error('[articles] updateArticleFlyoutAssignment failed', error);
		throw new Error('Could not update article settings.');
	}
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

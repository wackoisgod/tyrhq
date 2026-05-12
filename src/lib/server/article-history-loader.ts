import { error } from '@sveltejs/kit';
import { getPublishedArticle, type ArticleDetail, type ArticleType } from './articles';
import {
	getArticleRevisionDiff,
	listArticleContributors,
	listRevisionsForArticle,
	type ArticleContributor,
	type ArticleRevisionSummary,
	type RevisionDiff
} from './article-revisions';

export interface HistoryPageData {
	article: ArticleDetail;
	revisions: ArticleRevisionSummary[];
	contributors: ArticleContributor[];
}

export async function loadHistoryPage(type: ArticleType, slug: string): Promise<HistoryPageData> {
	const article = await getPublishedArticle(type, slug);
	if (!article) throw error(404, 'Article not found');

	const [revisions, contributors] = await Promise.all([
		listRevisionsForArticle(article.id),
		listArticleContributors(article.id)
	]);

	return { article, revisions, contributors };
}

export interface RevisionDiffPageData {
	article: ArticleDetail;
	diff: RevisionDiff;
}

export async function loadRevisionDiffPage(
	type: ArticleType,
	slug: string,
	revisionId: string
): Promise<RevisionDiffPageData> {
	const article = await getPublishedArticle(type, slug);
	if (!article) throw error(404, 'Article not found');

	const diff = await getArticleRevisionDiff(article.id, revisionId);
	if (!diff) throw error(404, 'Revision not found');

	return { article, diff };
}

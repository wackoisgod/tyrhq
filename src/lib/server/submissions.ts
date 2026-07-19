import { getSupabaseAdminClient } from './supabase-admin';
import {
	assertBodyLength,
	assertHeroImageUrl,
	computeContentHash,
	ContentValidationError,
	sanitizeArticleBody,
	sanitizeFrontmatter,
	type ArticleFrontmatterInput,
	type SanitizedFrontmatter
} from './content-sanitize';
import { isSlugTaken } from './articles';
import { collectStatRefErrors } from './game-data-refs';
import type { FlyoutSection } from '$lib/content/flyout-sections';

export type SubmissionStatus =
	| 'draft'
	| 'pending'
	| 'changes_requested'
	| 'approved'
	| 'rejected'
	| 'published';

export type SubmissionEventKind =
	| 'created'
	| 'edited'
	| 'submitted'
	| 'approved'
	| 'rejected'
	| 'changes_requested'
	| 'published'
	| 'withdrawn';

export type ProfileRole = 'user' | 'contributor' | 'admin';

export interface SubmissionRecord {
	id: string;
	type: 'guide' | 'article' | 'patch';
	parent_article_id: string | null;
	submitter_id: string;
	title: string;
	summary: string | null;
	slug: string | null;
	body_markdown: string;
	body_html: string;
	tags: string[];
	vehicle_slugs: string[] | null;
	status: SubmissionStatus;
	reviewer_id: string | null;
	review_notes: string | null;
	content_hash: string | null;
	created_at: string;
	updated_at: string;
	submitted_at: string | null;
	decided_at: string | null;
	flyout_section: FlyoutSection | null;
	flyout_order: number | null;
	hero_image_url: string | null;
	version: string | null;
	reviewer_body_markdown: string | null;
}

const SUBMISSION_COLUMNS =
	'id, type, parent_article_id, submitter_id, title, summary, slug, body_markdown, body_html, tags, vehicle_slugs, status, reviewer_id, review_notes, content_hash, created_at, updated_at, submitted_at, decided_at, flyout_section, flyout_order, hero_image_url, version, reviewer_body_markdown';

function requireAdmin() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new ContentValidationError(
			'server',
			'Contribution system requires SUPABASE_SERVICE_ROLE_KEY to be configured.'
		);
	}
	return admin;
}

export class SubmissionStateError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'SubmissionStateError';
		this.statusCode = statusCode;
	}
}

export interface SubmissionDraftInput {
	type: 'guide' | 'article' | 'patch';
	title: string;
	summary?: string | null;
	slug?: string | null;
	bodyMarkdown: string;
	tags?: string[];
	vehicleSlugs?: string[] | null;
	parentArticleId?: string | null;
	flyoutSection?: FlyoutSection | null;
	heroImageUrl?: string | null;
	version?: string | null;
	// When true, drop any reviewer-suggested body stored on the row (the author
	// has resolved the inline suggestions in the editor).
	clearReviewerSuggestions?: boolean;
}

export interface SanitizedSubmissionPayload {
	frontmatter: SanitizedFrontmatter;
	bodyHtml: string;
	bodyMarkdown: string;
	contentHash: string;
	heroImageUrl: string | null;
}

/**
 * Centralised sanitiser used by both the draft-save and the submit-for-review
 * flows. Throws ContentValidationError on any failure. The draft path catches
 * and stores partial input; the submit path re-runs this with stricter checks.
 */
export async function sanitizeSubmissionInput(
	input: SubmissionDraftInput,
	{ enforceLength }: { enforceLength: boolean }
): Promise<SanitizedSubmissionPayload> {
	const frontmatter = sanitizeFrontmatter({
		type: input.type,
		title: input.title,
		summary: input.summary,
		slug: input.slug,
		tags: input.tags,
		vehicleSlugs: input.vehicleSlugs,
		version: input.version
	} as ArticleFrontmatterInput);

	if (enforceLength) assertBodyLength(input.bodyMarkdown);

	const heroImageUrl = assertHeroImageUrl(input.heroImageUrl ?? null);
	const { html } = await sanitizeArticleBody(input.bodyMarkdown);

	// Reject inline :stat references to tanks/stats that don't exist in the game
	// data, so the author fixes them before review. Only enforced at the stricter
	// submit-time bar — drafts stay saveable while a slug is half-typed (the
	// preview just renders an em dash until the reference resolves).
	if (enforceLength) {
		const statRefErrors = collectStatRefErrors(html);
		if (statRefErrors.length > 0) {
			throw new ContentValidationError('body', statRefErrors[0]);
		}
	}

	const contentHash = computeContentHash(frontmatter, html, heroImageUrl);

	return {
		frontmatter,
		bodyHtml: html,
		bodyMarkdown: input.bodyMarkdown,
		contentHash,
		heroImageUrl
	};
}

interface RateLimitConfig {
	maxPending: number;
	maxSubmittedPerDay: number;
	minAccountAgeMinutes: number;
}

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
	maxPending: 3,
	maxSubmittedPerDay: 5,
	minAccountAgeMinutes: 24 * 60
};

export async function assertSubmissionRateLimits(
	submitterId: string,
	accountCreatedAt: string,
	role: ProfileRole = 'user',
	limits: RateLimitConfig = DEFAULT_RATE_LIMITS
): Promise<void> {
	if (role !== 'contributor' && role !== 'admin') {
		const ageMinutes = (Date.now() - new Date(accountCreatedAt).getTime()) / 60_000;
		if (ageMinutes < limits.minAccountAgeMinutes) {
			throw new SubmissionStateError(
				'New accounts must wait 24 hours before submitting their first article.',
				429
			);
		}
	}

	const admin = requireAdmin();

	const { count: pendingCount, error: pendingError } = await admin
		.from('article_submissions')
		.select('id', { head: true, count: 'exact' })
		.eq('submitter_id', submitterId)
		.in('status', ['pending', 'changes_requested']);

	if (pendingError) {
		console.error('[submissions] pending count failed', pendingError);
		throw new SubmissionStateError('Could not verify submission limits.', 500);
	}

	if ((pendingCount ?? 0) >= limits.maxPending) {
		throw new SubmissionStateError(
			`You have ${pendingCount} submissions awaiting review. Please wait for those to be processed before submitting more.`,
			429
		);
	}

	const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const { count: dayCount, error: dayError } = await admin
		.from('article_submissions')
		.select('id', { head: true, count: 'exact' })
		.eq('submitter_id', submitterId)
		.gte('submitted_at', dayAgo);

	if (dayError) {
		console.error('[submissions] day count failed', dayError);
		throw new SubmissionStateError('Could not verify submission limits.', 500);
	}

	if ((dayCount ?? 0) >= limits.maxSubmittedPerDay) {
		throw new SubmissionStateError(
			`You have already submitted ${dayCount} articles in the last 24 hours. Please try again later.`,
			429
		);
	}
}

export async function getSubmissionById(id: string): Promise<SubmissionRecord | null> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('article_submissions')
		.select(SUBMISSION_COLUMNS)
		.eq('id', id)
		.maybeSingle<SubmissionRecord>();
	if (error) {
		console.error('[submissions] getSubmissionById failed', error);
		throw new SubmissionStateError('Submission lookup failed.', 500);
	}
	return data ?? null;
}

export async function listSubmissionsForUser(userId: string): Promise<SubmissionRecord[]> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('article_submissions')
		.select(SUBMISSION_COLUMNS)
		.eq('submitter_id', userId)
		.order('updated_at', { ascending: false });
	if (error) {
		console.error('[submissions] listSubmissionsForUser failed', error);
		return [];
	}
	return (data as SubmissionRecord[]) ?? [];
}

export async function countPendingReviewSubmissions(): Promise<number> {
	const admin = getSupabaseAdminClient();
	if (!admin) return 0;
	const { count, error } = await admin
		.from('article_submissions')
		.select('id', { head: true, count: 'exact' })
		.eq('status', 'pending');
	if (error) {
		console.error('[submissions] countPendingReviewSubmissions failed', error);
		return 0;
	}
	return count ?? 0;
}

export async function listPendingSubmissions(): Promise<SubmissionRecord[]> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('article_submissions')
		.select(SUBMISSION_COLUMNS)
		.in('status', ['pending', 'changes_requested', 'approved'])
		.order('submitted_at', { ascending: true });
	if (error) {
		console.error('[submissions] listPendingSubmissions failed', error);
		return [];
	}
	return (data as SubmissionRecord[]) ?? [];
}

export async function createDraftSubmission(
	submitterId: string,
	input: SubmissionDraftInput
): Promise<SubmissionRecord> {
	const admin = requireAdmin();
	const sanitized = await sanitizeSubmissionInput(input, { enforceLength: false });

	const { data, error } = await admin
		.from('article_submissions')
		.insert({
			type: sanitized.frontmatter.type,
			parent_article_id: input.parentArticleId ?? null,
			submitter_id: submitterId,
			title: sanitized.frontmatter.title,
			summary: sanitized.frontmatter.summary,
			slug: sanitized.frontmatter.slug,
			body_markdown: sanitized.bodyMarkdown,
			body_html: sanitized.bodyHtml,
			tags: sanitized.frontmatter.tags,
			vehicle_slugs: sanitized.frontmatter.vehicleSlugs,
			content_hash: sanitized.contentHash,
			status: 'draft',
			flyout_section: input.flyoutSection ?? null,
			hero_image_url: sanitized.heroImageUrl,
			version: sanitized.frontmatter.type === 'patch' ? sanitized.frontmatter.version : null
		})
		.select(SUBMISSION_COLUMNS)
		.single<SubmissionRecord>();

	if (error || !data) {
		console.error('[submissions] createDraftSubmission failed', error);
		throw new SubmissionStateError('Could not save draft.', 500);
	}

	await recordSubmissionEvent(data.id, submitterId, 'created');
	return data;
}

export async function updateDraftSubmission(
	submissionId: string,
	submitterId: string,
	input: SubmissionDraftInput
): Promise<SubmissionRecord> {
	const admin = requireAdmin();
	const existing = await getSubmissionById(submissionId);
	if (!existing) throw new SubmissionStateError('Submission not found.', 404);
	if (existing.submitter_id !== submitterId) {
		throw new SubmissionStateError('You cannot edit another contributor’s submission.', 403);
	}
	if (!['draft', 'pending', 'changes_requested', 'rejected'].includes(existing.status)) {
		throw new SubmissionStateError(
			`Submission cannot be edited while status is "${existing.status}".`,
			409
		);
	}

	// While pending, re-validate at the stricter submit-time bar so a contributor
	// can't sneak a too-short body past review by editing it post-submit.
	const sanitized = await sanitizeSubmissionInput(input, {
		enforceLength: existing.status === 'pending'
	});

	const incomingFlyout = input.flyoutSection ?? null;
	const clearsSuggestions = Boolean(input.clearReviewerSuggestions && existing.reviewer_body_markdown);
	if (
		sanitized.contentHash === existing.content_hash &&
		incomingFlyout === existing.flyout_section &&
		!clearsSuggestions
	) {
		return existing;
	}

	// any meaningful edit on a "changes_requested" or "rejected" returns to draft.
	// "pending" stays "pending": the contributor can keep iterating until a reviewer
	// decides, but the submission does not need to be re-submitted.
	const reopens = existing.status === 'changes_requested' || existing.status === 'rejected';

	const { data, error } = await admin
		.from('article_submissions')
		.update({
			type: sanitized.frontmatter.type,
			title: sanitized.frontmatter.title,
			summary: sanitized.frontmatter.summary,
			slug: sanitized.frontmatter.slug,
			body_markdown: sanitized.bodyMarkdown,
			body_html: sanitized.bodyHtml,
			tags: sanitized.frontmatter.tags,
			vehicle_slugs: sanitized.frontmatter.vehicleSlugs,
			content_hash: sanitized.contentHash,
			status: reopens ? 'draft' : existing.status,
			flyout_section: input.flyoutSection ?? null,
			hero_image_url: sanitized.heroImageUrl,
			version: sanitized.frontmatter.type === 'patch' ? sanitized.frontmatter.version : null,
			reviewer_body_markdown: clearsSuggestions ? null : existing.reviewer_body_markdown
		})
		.eq('id', submissionId)
		.select(SUBMISSION_COLUMNS)
		.single<SubmissionRecord>();

	if (error || !data) {
		console.error('[submissions] updateDraftSubmission failed', error);
		throw new SubmissionStateError('Could not save draft.', 500);
	}

	await recordSubmissionEvent(data.id, submitterId, 'edited');
	return data;
}

export async function submitForReview(
	submissionId: string,
	submitterId: string,
	accountCreatedAt: string,
	role: ProfileRole = 'user'
): Promise<SubmissionRecord> {
	const admin = requireAdmin();
	const existing = await getSubmissionById(submissionId);
	if (!existing) throw new SubmissionStateError('Submission not found.', 404);
	if (existing.submitter_id !== submitterId) {
		throw new SubmissionStateError('You cannot submit another contributor’s draft.', 403);
	}
	if (!['draft', 'changes_requested', 'rejected'].includes(existing.status)) {
		throw new SubmissionStateError(
			`Submission is already in status "${existing.status}".`,
			409
		);
	}

	// Re-validate stricter at submit time so a contributor can't bypass length
	// checks by saving a too-short draft.
	const sanitized = await sanitizeSubmissionInput(
		{
			type: existing.type,
			title: existing.title,
			summary: existing.summary,
			slug: existing.slug,
			bodyMarkdown: existing.body_markdown,
			tags: existing.tags,
			vehicleSlugs: existing.vehicle_slugs,
			parentArticleId: existing.parent_article_id,
			flyoutSection: existing.flyout_section,
			heroImageUrl: existing.hero_image_url,
			version: existing.version
		},
		{ enforceLength: true }
	);

	// New article (no parent): slug must be unique
	if (!existing.parent_article_id) {
		const taken = await isSlugTaken(existing.type, sanitized.frontmatter.slug);
		if (taken) {
			throw new ContentValidationError(
				'slug',
				`Slug "${sanitized.frontmatter.slug}" is already taken by another article.`
			);
		}
	}

	await assertSubmissionRateLimits(submitterId, accountCreatedAt, role);

	const { data, error } = await admin
		.from('article_submissions')
		.update({
			body_html: sanitized.bodyHtml,
			content_hash: sanitized.contentHash,
			status: 'pending',
			submitted_at: new Date().toISOString(),
			decided_at: null,
			reviewer_id: null,
			review_notes: null,
			reviewer_body_markdown: null
		})
		.eq('id', submissionId)
		.select(SUBMISSION_COLUMNS)
		.single<SubmissionRecord>();

	if (error || !data) {
		console.error('[submissions] submitForReview failed', error);
		throw new SubmissionStateError('Could not submit for review.', 500);
	}

	await recordSubmissionEvent(data.id, submitterId, 'submitted');
	return data;
}

export type ReviewDecision = 'approve' | 'changes_requested' | 'reject';

export interface DecisionInput {
	decision: ReviewDecision;
	notes?: string | null;
	// Admin-set flyout placement (only applied when decision is "approve").
	// Defaults to the contributor's proposal stored on the submission row.
	flyoutSection?: FlyoutSection | null;
	flyoutOrder?: number | null;
	// Optimistic-concurrency guard. When provided, the reviewer's decision
	// is rejected if the row's content_hash no longer matches (the contributor
	// edited the pending submission while the reviewer was reading it).
	expectedContentHash?: string | null;
	// Reviewer's inline-edited body, sent with a "changes_requested" decision.
	// Stored verbatim (after validation) so the author can accept/reject the
	// reviewer's edits hunk-by-hunk. Ignored for approve/reject.
	reviewerBodyMarkdown?: string | null;
}

export async function decideSubmission(
	submissionId: string,
	reviewer: { id: string; role: ProfileRole },
	input: DecisionInput
): Promise<SubmissionRecord> {
	if (reviewer.role !== 'contributor' && reviewer.role !== 'admin') {
		throw new SubmissionStateError('Only contributors can review submissions.', 403);
	}

	const admin = requireAdmin();
	const existing = await getSubmissionById(submissionId);
	if (!existing) throw new SubmissionStateError('Submission not found.', 404);
	if (existing.status !== 'pending') {
		throw new SubmissionStateError(
			`Submission is in status "${existing.status}" and cannot be decided.`,
			409
		);
	}
	if (existing.submitter_id === reviewer.id && reviewer.role !== 'admin') {
		throw new SubmissionStateError(
			'Contributors cannot review their own submissions. Ask another reviewer.',
			403
		);
	}
	if (
		input.expectedContentHash &&
		existing.content_hash &&
		input.expectedContentHash !== existing.content_hash
	) {
		throw new SubmissionStateError(
			'The contributor edited this submission while you were reviewing. Reload to see the latest version before deciding.',
			409
		);
	}

	const decidedAt = new Date().toISOString();
	const reviewNotes = input.notes?.trim() || null;

	if (input.decision === 'approve') {
		// Admin override of flyout placement. `undefined` means "no override
		// supplied — use the contributor's proposal stored on the row"; an
		// explicit `null` means "remove from flyout".
		const finalSection: FlyoutSection | null =
			input.flyoutSection !== undefined ? input.flyoutSection : existing.flyout_section;
		const finalOrder: number | null = finalSection
			? input.flyoutOrder !== undefined
				? input.flyoutOrder
				: existing.flyout_order
			: null;

		const article = await publishApprovedSubmission(existing, reviewer.id, {
			flyoutSection: finalSection,
			flyoutOrder: finalOrder
		});
		const { data, error } = await admin
			.from('article_submissions')
			.update({
				status: 'published',
				reviewer_id: reviewer.id,
				review_notes: reviewNotes,
				decided_at: decidedAt,
				flyout_section: finalSection,
				flyout_order: finalOrder,
				reviewer_body_markdown: null
			})
			.eq('id', submissionId)
			.select(SUBMISSION_COLUMNS)
			.single<SubmissionRecord>();
		if (error || !data) {
			console.error('[submissions] post-approve update failed', error);
			throw new SubmissionStateError('Submission published but status update failed.', 500);
		}
		await recordSubmissionEvent(data.id, reviewer.id, 'approved', reviewNotes);
		await recordSubmissionEvent(data.id, reviewer.id, 'published', `article:${article.id}`);
		return data;
	}

	const newStatus: SubmissionStatus =
		input.decision === 'changes_requested' ? 'changes_requested' : 'rejected';

	// Only "changes_requested" carries an inline-edit proposal back to the
	// author. Store it only when it actually differs from what they submitted,
	// and validate it through the same sanitiser so a malformed suggestion can't
	// be persisted. Rejecting clears any prior suggestion.
	let reviewerBodyToStore: string | null = null;
	if (input.decision === 'changes_requested' && input.reviewerBodyMarkdown != null) {
		const proposed = input.reviewerBodyMarkdown;
		if (proposed.trim() && proposed !== existing.body_markdown) {
			await sanitizeArticleBody(proposed);
			reviewerBodyToStore = proposed;
		}
	}

	const { data, error } = await admin
		.from('article_submissions')
		.update({
			status: newStatus,
			reviewer_id: reviewer.id,
			review_notes: reviewNotes,
			decided_at: decidedAt,
			reviewer_body_markdown: reviewerBodyToStore
		})
		.eq('id', submissionId)
		.select(SUBMISSION_COLUMNS)
		.single<SubmissionRecord>();

	if (error || !data) {
		console.error('[submissions] decision update failed', error);
		throw new SubmissionStateError('Decision failed.', 500);
	}

	await recordSubmissionEvent(
		data.id,
		reviewer.id,
		input.decision === 'changes_requested' ? 'changes_requested' : 'rejected',
		reviewNotes
	);
	return data;
}

interface PublishedArticleRow {
	id: string;
	type: 'guide' | 'article' | 'patch';
	slug: string;
}

interface PublishedAuthorInfo {
	authorDisplay: string | null;
	authorUserId: string | null;
}

async function getProfileDisplayName(userId: string): Promise<string | null> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('profiles')
		.select('display_name')
		.eq('id', userId)
		.maybeSingle<{ display_name: string | null }>();

	if (error) {
		console.error('[submissions] author profile lookup failed', error);
		throw new SubmissionStateError('Approval failed: could not resolve the author profile.', 500);
	}

	return data?.display_name?.trim() || null;
}

async function resolvePublishedAuthor(submission: SubmissionRecord): Promise<PublishedAuthorInfo> {
	if (!submission.parent_article_id) {
		return {
			authorDisplay: await getProfileDisplayName(submission.submitter_id),
			authorUserId: submission.submitter_id
		};
	}

	const admin = requireAdmin();
	const { data: existingArticle, error } = await admin
		.from('articles')
		.select('author_display, author_user_id')
		.eq('id', submission.parent_article_id)
		.maybeSingle<{ author_display: string | null; author_user_id: string | null }>();

	if (error) {
		console.error('[submissions] existing article author lookup failed', error);
		throw new SubmissionStateError('Approval failed: could not load the published article.', 500);
	}

	if (!existingArticle) {
		throw new SubmissionStateError('Approval failed: parent article not found.', 500);
	}

	return {
		authorDisplay:
			existingArticle.author_display?.trim() ||
			(existingArticle.author_user_id
				? await getProfileDisplayName(existingArticle.author_user_id)
				: null),
		authorUserId: existingArticle.author_user_id
	};
}

interface PublishOptions {
	flyoutSection: FlyoutSection | null;
	flyoutOrder: number | null;
}

async function publishApprovedSubmission(
	submission: SubmissionRecord,
	reviewerId: string,
	options: PublishOptions
): Promise<PublishedArticleRow> {
	const admin = requireAdmin();
	const now = new Date().toISOString();

	// Idempotency guard: if this submission has already produced a revision,
	// the publish previously succeeded and only the post-approve UPDATE on the
	// submission row failed (e.g. transient DB error, dropped constraint).
	// Skip the article+revision writes so retrying doesn't duplicate history.
	const { data: existingRevision } = await admin
		.from('article_revisions')
		.select('article_id')
		.eq('source_submission_id', submission.id)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle<{ article_id: string }>();

	if (existingRevision) {
		const { data: existingArticle, error: lookupError } = await admin
			.from('articles')
			.select('id, type, slug')
			.eq('id', existingRevision.article_id)
			.single<PublishedArticleRow>();
		if (lookupError || !existingArticle) {
			console.error('[submissions] idempotency lookup failed', lookupError);
			throw new SubmissionStateError(
				'Approval failed: could not locate the previously published article.',
				500
			);
		}
		return existingArticle;
	}

	const author = await resolvePublishedAuthor(submission);

	// 1. Upsert the article row.
	let articleId = submission.parent_article_id;
	let articleRow: PublishedArticleRow;

	if (articleId) {
		const { data, error } = await admin
			.from('articles')
			.update({
				type: submission.type,
				slug: submission.slug ?? '',
				title: submission.title,
				summary: submission.summary,
				body_markdown: submission.body_markdown,
				body_html: submission.body_html,
				author_display: author.authorDisplay,
				author_user_id: author.authorUserId,
				tags: submission.tags,
				vehicle_slugs: submission.vehicle_slugs,
				status: 'published',
				published_at: now,
				flyout_section: options.flyoutSection,
				flyout_order: options.flyoutSection ? options.flyoutOrder : null,
				hero_image_url: submission.hero_image_url,
				version: submission.type === 'patch' ? submission.version : null
			})
			.eq('id', articleId)
			.select('id, type, slug')
			.single<PublishedArticleRow>();
		if (error || !data) {
			console.error('[submissions] update article failed', error);
			throw new SubmissionStateError('Approval failed: could not update article.', 500);
		}
		articleRow = data;
	} else {
		const { data, error } = await admin
			.from('articles')
			.insert({
				type: submission.type,
				slug: submission.slug ?? '',
				title: submission.title,
				summary: submission.summary,
				body_markdown: submission.body_markdown,
				body_html: submission.body_html,
				author_display: author.authorDisplay,
				author_user_id: author.authorUserId,
				tags: submission.tags,
				vehicle_slugs: submission.vehicle_slugs,
				status: 'published',
				published_at: now,
				flyout_section: options.flyoutSection,
				flyout_order: options.flyoutSection ? options.flyoutOrder : null,
				hero_image_url: submission.hero_image_url,
				version: submission.type === 'patch' ? submission.version : null
			})
			.select('id, type, slug')
			.single<PublishedArticleRow>();
		if (error || !data) {
			console.error('[submissions] insert article failed', error);
			throw new SubmissionStateError('Approval failed: could not create article.', 500);
		}
		articleRow = data;
		articleId = data.id;
	}

	// 2. Append a revision and link it as current.
	const { data: revision, error: revisionError } = await admin
		.from('article_revisions')
		.insert({
			article_id: articleId,
			source_submission_id: submission.id,
			title: submission.title,
			summary: submission.summary,
			body_markdown: submission.body_markdown,
			body_html: submission.body_html,
			tags: submission.tags,
			vehicle_slugs: submission.vehicle_slugs,
			author_display: author.authorDisplay,
			created_by: reviewerId,
			hero_image_url: submission.hero_image_url
		})
		.select('id')
		.single<{ id: string }>();

	if (revisionError || !revision) {
		console.error('[submissions] insert revision failed', revisionError);
		throw new SubmissionStateError('Approval failed: could not append revision.', 500);
	}

	const { error: linkError } = await admin
		.from('articles')
		.update({ current_revision_id: revision.id })
		.eq('id', articleId);

	if (linkError) {
		console.error('[submissions] link revision failed', linkError);
		// Non-fatal — the article is published; current_revision_id can be backfilled.
	}

	return articleRow;
}

// Statuses a contributor (or admin) is allowed to delete. Anything tied to a
// live article (`published`) or mid-publish (`approved`) is excluded — those
// belong to the audit trail and would orphan the article row.
const DELETABLE_STATUSES: SubmissionStatus[] = [
	'draft',
	'pending',
	'changes_requested',
	'rejected'
];

export async function deleteSubmission(
	submissionId: string,
	actor: { id: string; role: ProfileRole }
): Promise<void> {
	const admin = requireAdmin();
	const existing = await getSubmissionById(submissionId);
	if (!existing) throw new SubmissionStateError('Submission not found.', 404);

	const isOwner = existing.submitter_id === actor.id;
	const isAdmin = actor.role === 'admin';
	if (!isOwner && !isAdmin) {
		throw new SubmissionStateError('You can only delete your own submissions.', 403);
	}

	if (!DELETABLE_STATUSES.includes(existing.status)) {
		throw new SubmissionStateError(
			`Cannot delete a submission in status "${existing.status}".`,
			409
		);
	}

	const { error } = await admin.from('article_submissions').delete().eq('id', submissionId);
	if (error) {
		console.error('[submissions] deleteSubmission failed', error);
		throw new SubmissionStateError('Could not delete submission.', 500);
	}
}

function assertModerator(actor: { role: ProfileRole }) {
	if (actor.role !== 'contributor' && actor.role !== 'admin') {
		throw new SubmissionStateError('Reviewer or admin role required.', 403);
	}
}

export async function withdrawArticle(
	articleId: string,
	actor: { id: string; role: ProfileRole }
): Promise<void> {
	assertModerator(actor);
	const admin = requireAdmin();
	const { error } = await admin
		.from('articles')
		.update({ status: 'withdrawn' })
		.eq('id', articleId);
	if (error) {
		console.error('[submissions] withdrawArticle failed', error);
		throw new SubmissionStateError('Could not withdraw article.', 500);
	}
}

export async function restoreArticle(
	articleId: string,
	actor: { id: string; role: ProfileRole }
): Promise<void> {
	assertModerator(actor);
	const admin = requireAdmin();
	const { error } = await admin
		.from('articles')
		.update({ status: 'published' })
		.eq('id', articleId);
	if (error) {
		console.error('[submissions] restoreArticle failed', error);
		throw new SubmissionStateError('Could not restore article.', 500);
	}
}

/**
 * Clone an existing published article into a fresh draft submission so the
 * author can propose an edit. Re-uses the live body markdown as the starting
 * point; the reviewer eventually sees a side-by-side diff (live vs proposed)
 * via `parent_article_id` on the submission.
 */
export async function createSuggestedEditFromArticle(
	articleId: string,
	submitterId: string
): Promise<SubmissionRecord> {
	const admin = requireAdmin();

	const { data: article, error: articleError } = await admin
		.from('articles')
		.select(
			'id, type, slug, title, summary, body_markdown, body_html, tags, vehicle_slugs, status, flyout_section, hero_image_url, version'
		)
		.eq('id', articleId)
		.maybeSingle<{
			id: string;
			type: 'guide' | 'article' | 'patch';
			slug: string;
			title: string;
			summary: string | null;
			body_markdown: string;
			body_html: string;
			tags: string[] | null;
			vehicle_slugs: string[] | null;
			status: 'draft' | 'published' | 'withdrawn';
			flyout_section: FlyoutSection | null;
			hero_image_url: string | null;
			version: string | null;
		}>();

	if (articleError || !article) {
		throw new SubmissionStateError('Article not found.', 404);
	}
	if (article.status !== 'published') {
		throw new SubmissionStateError(
			'Only published articles can be edited via suggestion.',
			409
		);
	}

	// If the user already has an open suggested-edit draft for this article,
	// hand them back the same row instead of duplicating.
	const { data: existing } = await admin
		.from('article_submissions')
		.select(SUBMISSION_COLUMNS)
		.eq('parent_article_id', articleId)
		.eq('submitter_id', submitterId)
		.in('status', ['draft', 'changes_requested'])
		.order('updated_at', { ascending: false })
		.limit(1)
		.maybeSingle<SubmissionRecord>();

	if (existing) return existing;

	const sanitized = await sanitizeSubmissionInput(
		{
			type: article.type,
			title: article.title,
			summary: article.summary,
			slug: article.slug,
			bodyMarkdown: article.body_markdown,
			tags: article.tags ?? [],
			vehicleSlugs: article.vehicle_slugs,
			parentArticleId: article.id,
			flyoutSection: article.flyout_section,
			heroImageUrl: article.hero_image_url,
			version: article.version
		},
		{ enforceLength: false }
	);

	const { data, error } = await admin
		.from('article_submissions')
		.insert({
			type: article.type,
			parent_article_id: article.id,
			submitter_id: submitterId,
			title: sanitized.frontmatter.title,
			summary: sanitized.frontmatter.summary,
			slug: sanitized.frontmatter.slug,
			body_markdown: sanitized.bodyMarkdown,
			body_html: sanitized.bodyHtml,
			tags: sanitized.frontmatter.tags,
			vehicle_slugs: sanitized.frontmatter.vehicleSlugs,
			content_hash: sanitized.contentHash,
			status: 'draft',
			flyout_section: article.flyout_section,
			hero_image_url: sanitized.heroImageUrl,
			version: article.type === 'patch' ? sanitized.frontmatter.version : null
		})
		.select(SUBMISSION_COLUMNS)
		.single<SubmissionRecord>();

	if (error || !data) {
		console.error('[submissions] createSuggestedEditFromArticle failed', error);
		throw new SubmissionStateError('Could not start a suggested edit.', 500);
	}

	await recordSubmissionEvent(data.id, submitterId, 'created', `from-article:${articleId}`);
	return data;
}

async function recordSubmissionEvent(
	submissionId: string,
	actorId: string | null,
	kind: SubmissionEventKind,
	note: string | null = null
): Promise<void> {
	const admin = requireAdmin();
	const { error } = await admin.from('submission_events').insert({
		submission_id: submissionId,
		actor_id: actorId,
		kind,
		note
	});
	if (error) {
		// Audit failures shouldn't break the user-facing flow; just log.
		console.error('[submissions] recordSubmissionEvent failed', error);
	}
}

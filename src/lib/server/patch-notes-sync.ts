/**
 * Mirrors the official Tyr patch notes into our `articles` table.
 *
 * Patch notes used to arrive through the contribution pipeline like guides and
 * articles: someone pasted the official notes into the editor and a reviewer
 * published them. They now come straight from the source
 * (https://www.playtyr.com/patch-notes) via `patch-notes-source.ts`, and this
 * module is what turns a scrape into rows.
 *
 * The design rules, in order of importance:
 *
 *   - **Idempotent.** A run over unchanged notes rewrites nothing. We compare
 *     upstream's `updated_at` first (free, it comes with the index) and the
 *     hash of the fully rendered payload second, so an unchanged note costs at
 *     most one bookkeeping write of `source_synced_at` — which migration 019
 *     deliberately keeps out of `articles.updated_at`.
 *   - **Never clobber local work.** A row with `source = 'local'` belongs to a
 *     human. If one already holds the slug we want, the note is skipped and
 *     reported, not overwritten.
 *   - **Moderation sticks.** Withdrawing a mirrored note keeps it withdrawn;
 *     updates never reset `status`. Only the first insert publishes.
 *   - **One bad note is not a failed run.** Every note is fetched, rendered
 *     and written independently, and failures land in the report.
 */

import { createHash } from 'node:crypto';

import { sanitizeMirroredBody } from './content-sanitize';
import {
	fetchPatchNote,
	fetchPatchNoteIndex,
	PatchNoteSourceError,
	resolvePatchNotesOrigin,
	type UpstreamPatchNote,
	type UpstreamPatchNoteStub
} from './patch-notes-source';
import { getSupabaseAdminClient } from './supabase-admin';

/** Value of `articles.source` for rows this module owns. */
export const OFFICIAL_SOURCE = 'official';

/** Byline shown on mirrored notes. They are the studio's words, not ours. */
export const OFFICIAL_AUTHOR_DISPLAY = 'Stoke Games';

/**
 * Refuse absurdly large bodies rather than pushing them into every listing
 * query. The longest official note to date is ~19k characters.
 */
export const MAX_MIRRORED_BODY_CHARS = 200_000;

export class PatchNoteSyncError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatchNoteSyncError';
	}
}

export type PatchNoteSyncOutcome =
	| 'created'
	/** An existing mirrored row was rewritten because upstream changed. */
	| 'updated'
	/** A locally uploaded row with the same slug was taken over by the mirror. */
	| 'adopted'
	| 'unchanged'
	/** Deliberately left alone — see `reason`. */
	| 'skipped'
	| 'failed';

export interface PatchNoteSyncEntry {
	sourceKey: string;
	title: string;
	outcome: PatchNoteSyncOutcome;
	reason?: string;
}

export interface PatchNoteSyncReport {
	origin: string;
	startedAt: string;
	finishedAt: string;
	/** Notes seen in the official index during this run. */
	checked: number;
	created: number;
	updated: number;
	adopted: number;
	unchanged: number;
	skipped: number;
	failed: number;
	entries: PatchNoteSyncEntry[];
}

export interface PatchNoteSyncOptions {
	/**
	 * How many index pages to walk. The scheduled run only needs the first page
	 * to notice a new release; omit for a full backfill.
	 */
	maxPages?: number;
	/** Re-render and rewrite every note even if its hash is unchanged. */
	force?: boolean;
	/**
	 * Take over a locally uploaded patch note whose slug matches an upstream
	 * note exactly. Keeps the row's URL and stars instead of stranding a
	 * duplicate. On by default; the report always says when it happened.
	 */
	adoptLocal?: boolean;
	origin?: string;
	fetch?: typeof globalThis.fetch;
	/** Injected by tests. */
	now?: () => Date;
	store?: PatchNoteStore;
}

/* ------------------------------------------------------------------ *
 * Store seam
 *
 * The diff logic below is the part worth testing, and testing it against
 * Supabase's chained query builder means mocking a fluent API rather than
 * behaviour. So the writes live behind this interface, with the real
 * implementation at the bottom of the file.
 * ------------------------------------------------------------------ */

export interface StoredPatchArticle {
	id: string;
	slug: string;
	status: 'draft' | 'published' | 'withdrawn';
	source: string;
	sourceKey: string | null;
	sourceHash: string | null;
	sourceUpdatedAt: string | null;
}

/** The mirrored column values for one note. */
export interface MirroredArticleInput {
	slug: string;
	title: string;
	summary: string | null;
	version: string | null;
	bodySource: string;
	bodyHtml: string;
	publishedAt: string;
	sourceKey: string;
	sourceUrl: string;
	sourceHash: string;
	sourceUpdatedAt: string | null;
	syncedAt: string;
}

export interface PatchNoteStore {
	/** Every `type = 'patch'` row, local and mirrored alike. */
	listPatchArticles(): Promise<StoredPatchArticle[]>;
	createMirroredArticle(input: MirroredArticleInput): Promise<string>;
	/** Rewrites content + provenance. Must not touch `status`. */
	updateMirroredArticle(articleId: string, input: MirroredArticleInput): Promise<void>;
	/** Records the mirrored body in article history and links it as current. */
	appendRevision(articleId: string, input: MirroredArticleInput): Promise<void>;
	/**
	 * Bookkeeping-only write for a note that turned out to be unchanged.
	 * Recording the upstream timestamp matters: without it, a note whose
	 * upstream `updated_at` moved but whose content didn't would be re-fetched
	 * and re-rendered on every run forever. Migration 019 keeps these writes
	 * from touching `articles.updated_at`.
	 */
	markChecked(
		articleId: string,
		syncedAt: string,
		sourceUpdatedAt: string | null
	): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Hashing
 * ------------------------------------------------------------------ */

/**
 * Fingerprint of everything we mirror for one note. Stored on the row so a
 * later run can tell "upstream was edited" from "nothing to do" even when
 * upstream's own `updated_at` is unavailable (the HTML fallback has no
 * timestamps to offer).
 */
export function computeMirrorHash(input: {
	title: string;
	summary: string | null;
	version: string | null;
	publishedAt: string;
	bodyHtml: string;
}): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				title: input.title,
				summary: input.summary,
				version: input.version,
				publishedAt: input.publishedAt,
				bodyHtml: input.bodyHtml
			})
		)
		.digest('hex');
}

/**
 * When we can skip fetching a note's body entirely: we already mirror it,
 * upstream reported an `updated_at`, and it matches what we last saw.
 */
export function canSkipUpstreamFetch(
	existing: StoredPatchArticle | undefined,
	stub: UpstreamPatchNoteStub,
	force: boolean
): boolean {
	if (force || !existing) return false;
	if (existing.source !== OFFICIAL_SOURCE) return false;
	if (!existing.sourceHash) return false;
	if (!stub.updatedAt || !existing.sourceUpdatedAt) return false;
	return existing.sourceUpdatedAt === stub.updatedAt;
}

/**
 * The date we present a mirrored note under. Prefer upstream's publish
 * timestamp, fall back to the release date it shows readers, and only then to
 * our own clock — ordering on /patch-notes is by this value.
 */
export function resolvePublishedAt(stub: UpstreamPatchNoteStub, now: Date): string {
	if (stub.publishedAt) return stub.publishedAt;
	if (stub.releaseDate) return `${stub.releaseDate}T00:00:00.000Z`;
	return now.toISOString();
}

/* ------------------------------------------------------------------ *
 * Sync
 * ------------------------------------------------------------------ */

export async function syncOfficialPatchNotes(
	options: PatchNoteSyncOptions = {}
): Promise<PatchNoteSyncReport> {
	const now = options.now ?? (() => new Date());
	const origin = resolvePatchNotesOrigin(options.origin);
	const store = options.store ?? createSupabasePatchNoteStore();
	const force = options.force ?? false;
	const adoptLocal = options.adoptLocal ?? true;

	const startedAt = now().toISOString();
	const entries: PatchNoteSyncEntry[] = [];

	const stubs = await fetchPatchNoteIndex({
		origin,
		fetch: options.fetch,
		maxPages: options.maxPages
	});

	const existingRows = await store.listPatchArticles();
	const bySourceKey = new Map<string, StoredPatchArticle>();
	const bySlug = new Map<string, StoredPatchArticle>();
	for (const row of existingRows) {
		if (row.source === OFFICIAL_SOURCE && row.sourceKey) bySourceKey.set(row.sourceKey, row);
		bySlug.set(row.slug, row);
	}

	for (const stub of stubs) {
		try {
			entries.push(
				await syncOne(stub, {
					store,
					origin,
					fetch: options.fetch,
					force,
					adoptLocal,
					now,
					bySourceKey,
					bySlug
				})
			);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			console.error(`[patch-notes-sync] ${stub.sourceKey} failed`, err);
			entries.push({
				sourceKey: stub.sourceKey,
				title: stub.title,
				outcome: 'failed',
				reason
			});
		}
	}

	const count = (outcome: PatchNoteSyncOutcome) =>
		entries.filter((entry) => entry.outcome === outcome).length;

	return {
		origin,
		startedAt,
		finishedAt: now().toISOString(),
		checked: entries.length,
		created: count('created'),
		updated: count('updated'),
		adopted: count('adopted'),
		unchanged: count('unchanged'),
		skipped: count('skipped'),
		failed: count('failed'),
		entries
	};
}

interface SyncOneContext {
	store: PatchNoteStore;
	origin: string;
	fetch?: typeof globalThis.fetch;
	force: boolean;
	adoptLocal: boolean;
	now: () => Date;
	bySourceKey: Map<string, StoredPatchArticle>;
	bySlug: Map<string, StoredPatchArticle>;
}

async function syncOne(
	stub: UpstreamPatchNoteStub,
	ctx: SyncOneContext
): Promise<PatchNoteSyncEntry> {
	const mirrored = ctx.bySourceKey.get(stub.sourceKey);
	const syncedAt = ctx.now().toISOString();

	// Cheapest exit: upstream says it hasn't changed since we last mirrored it.
	if (canSkipUpstreamFetch(mirrored, stub, ctx.force)) {
		await ctx.store.markChecked(mirrored!.id, syncedAt, mirrored!.sourceUpdatedAt);
		return { sourceKey: stub.sourceKey, title: stub.title, outcome: 'unchanged' };
	}

	// Decide where this note is going to live before spending a fetch on it.
	const target = resolveTarget(stub, ctx);
	if (target.kind === 'skip') {
		return {
			sourceKey: stub.sourceKey,
			title: stub.title,
			outcome: 'skipped',
			reason: target.reason
		};
	}

	const upstream = await fetchPatchNote(stub.sourceKey, {
		origin: ctx.origin,
		fetch: ctx.fetch
	});

	if (upstream.body.content.length > MAX_MIRRORED_BODY_CHARS) {
		return {
			sourceKey: stub.sourceKey,
			title: stub.title,
			outcome: 'skipped',
			reason: `Upstream body is ${upstream.body.content.length} characters, over the ${MAX_MIRRORED_BODY_CHARS} limit`
		};
	}

	const input = await buildMirroredInput(stub, upstream, ctx, syncedAt);

	if (target.kind === 'create') {
		const articleId = await ctx.store.createMirroredArticle(input);
		await ctx.store.appendRevision(articleId, input);
		const row: StoredPatchArticle = {
			id: articleId,
			slug: input.slug,
			status: 'published',
			source: OFFICIAL_SOURCE,
			sourceKey: input.sourceKey,
			sourceHash: input.sourceHash,
			sourceUpdatedAt: input.sourceUpdatedAt
		};
		ctx.bySourceKey.set(input.sourceKey, row);
		ctx.bySlug.set(input.slug, row);
		return { sourceKey: stub.sourceKey, title: stub.title, outcome: 'created' };
	}

	const existing = target.row;

	// Rendered payload is byte-identical to what we already store: upstream
	// bumped a timestamp without changing anything readers can see.
	if (!ctx.force && existing.sourceHash === input.sourceHash) {
		await ctx.store.markChecked(existing.id, syncedAt, input.sourceUpdatedAt);
		existing.sourceUpdatedAt = input.sourceUpdatedAt;
		return { sourceKey: stub.sourceKey, title: stub.title, outcome: 'unchanged' };
	}

	await ctx.store.updateMirroredArticle(existing.id, input);
	await ctx.store.appendRevision(existing.id, input);

	existing.slug = input.slug;
	existing.source = OFFICIAL_SOURCE;
	existing.sourceKey = input.sourceKey;
	existing.sourceHash = input.sourceHash;
	existing.sourceUpdatedAt = input.sourceUpdatedAt;
	ctx.bySourceKey.set(input.sourceKey, existing);
	ctx.bySlug.set(input.slug, existing);

	return {
		sourceKey: stub.sourceKey,
		title: stub.title,
		outcome: target.kind === 'adopt' ? 'adopted' : 'updated'
	};
}

type SyncTarget =
	| { kind: 'create' }
	| { kind: 'update'; row: StoredPatchArticle }
	| { kind: 'adopt'; row: StoredPatchArticle }
	| { kind: 'skip'; reason: string };

/**
 * Work out which row an upstream note maps to.
 *
 * Identity is the upstream key, not the slug — upstream can rename a slug and
 * we follow it. The slug still matters because `articles` is unique on
 * (type, slug), so anything already sitting on the destination slug has to be
 * resolved first.
 */
export function resolveTarget(
	stub: UpstreamPatchNoteStub,
	ctx: {
		adoptLocal: boolean;
		bySourceKey: Map<string, StoredPatchArticle>;
		bySlug: Map<string, StoredPatchArticle>;
	}
): SyncTarget {
	const mirrored = ctx.bySourceKey.get(stub.sourceKey);
	const slugHolder = ctx.bySlug.get(stub.sourceKey);

	if (mirrored) {
		// Upstream renamed the slug and something else already holds the new one.
		if (slugHolder && slugHolder.id !== mirrored.id) {
			return {
				kind: 'skip',
				reason: `Upstream slug "${stub.sourceKey}" is already taken by another patch note (${slugHolder.id})`
			};
		}
		return { kind: 'update', row: mirrored };
	}

	if (slugHolder) {
		if (slugHolder.source !== 'local') {
			return {
				kind: 'skip',
				reason: `Slug "${stub.sourceKey}" is mirrored from a different upstream note`
			};
		}
		if (!ctx.adoptLocal) {
			return {
				kind: 'skip',
				reason: `Slug "${stub.sourceKey}" belongs to a locally uploaded patch note`
			};
		}
		return { kind: 'adopt', row: slugHolder };
	}

	return { kind: 'create' };
}

async function buildMirroredInput(
	stub: UpstreamPatchNoteStub,
	upstream: UpstreamPatchNote,
	ctx: SyncOneContext,
	syncedAt: string
): Promise<MirroredArticleInput> {
	const { html } = await sanitizeMirroredBody(upstream.body, {
		allowedImageOrigins: [ctx.origin]
	});
	if (!html.trim()) {
		throw new PatchNoteSyncError(
			`Upstream note "${stub.sourceKey}" rendered to an empty body after sanitising`
		);
	}

	// Prefer the detail payload's own metadata (it is the note's canonical
	// record) and fall back to the index stub, which is all the HTML fallback
	// path can offer.
	const title = upstream.title || stub.title;
	const summary = upstream.summary ?? stub.summary;
	const version = upstream.version ?? stub.version;
	const publishedAt = resolvePublishedAt(
		{
			...stub,
			publishedAt: upstream.publishedAt ?? stub.publishedAt,
			releaseDate: upstream.releaseDate ?? stub.releaseDate
		},
		ctx.now()
	);

	return {
		slug: stub.sourceKey,
		title,
		summary,
		version,
		// Store upstream's markdown where we have it, so the admin revision diff
		// reads as prose; fall back to whatever we actually rendered from.
		bodySource: upstream.markdown ?? upstream.body.content,
		bodyHtml: html,
		publishedAt,
		sourceKey: stub.sourceKey,
		sourceUrl: upstream.sourceUrl,
		sourceHash: computeMirrorHash({ title, summary, version, publishedAt, bodyHtml: html }),
		sourceUpdatedAt: upstream.updatedAt ?? stub.updatedAt,
		syncedAt
	};
}

/* ------------------------------------------------------------------ *
 * Supabase-backed store
 * ------------------------------------------------------------------ */

interface PatchArticleRow {
	id: string;
	slug: string;
	status: 'draft' | 'published' | 'withdrawn';
	source: string | null;
	source_key: string | null;
	source_hash: string | null;
	source_updated_at: string | null;
}

export function createSupabasePatchNoteStore(): PatchNoteStore {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new PatchNoteSyncError(
			'Patch note sync requires SUPABASE_SERVICE_ROLE_KEY to be configured.'
		);
	}

	function fail(action: string, error: { message?: string } | null): never {
		throw new PatchNoteSyncError(`${action} failed: ${error?.message ?? 'unknown error'}`);
	}

	/**
	 * Column values shared by insert and update. `status` is deliberately absent
	 * so a withdrawn note stays withdrawn across syncs, and `author_user_id`
	 * stays null so mirrored notes never attribute to a site account.
	 */
	function contentColumns(input: MirroredArticleInput) {
		return {
			slug: input.slug,
			title: input.title,
			summary: input.summary,
			// Upstream's markdown source where it offers one; the HTML-scraping
			// fallback has none, so it stores the markup it mirrored instead.
			body_markdown: input.bodySource,
			body_html: input.bodyHtml,
			author_display: OFFICIAL_AUTHOR_DISPLAY,
			author_user_id: null,
			published_at: input.publishedAt,
			version: input.version,
			source: OFFICIAL_SOURCE,
			source_key: input.sourceKey,
			source_url: input.sourceUrl,
			source_hash: input.sourceHash,
			source_updated_at: input.sourceUpdatedAt,
			source_synced_at: input.syncedAt
		};
	}

	return {
		async listPatchArticles() {
			const { data, error } = await admin
				.from('articles')
				.select('id, slug, status, source, source_key, source_hash, source_updated_at')
				.eq('type', 'patch');
			if (error) fail('Listing patch notes', error);
			return ((data ?? []) as PatchArticleRow[]).map((row) => ({
				id: row.id,
				slug: row.slug,
				status: row.status,
				source: row.source ?? 'local',
				sourceKey: row.source_key,
				sourceHash: row.source_hash,
				sourceUpdatedAt: row.source_updated_at
			}));
		},

		async createMirroredArticle(input) {
			const { data, error } = await admin
				.from('articles')
				.insert({
					type: 'patch',
					status: 'published',
					tags: [],
					vehicle_slugs: null,
					...contentColumns(input)
				})
				.select('id')
				.single<{ id: string }>();
			if (error || !data) fail('Creating mirrored patch note', error);
			return data.id;
		},

		async updateMirroredArticle(articleId, input) {
			const { error } = await admin
				.from('articles')
				.update(contentColumns(input))
				.eq('id', articleId);
			if (error) fail('Updating mirrored patch note', error);
		},

		async appendRevision(articleId, input) {
			// `created_by` and `source_submission_id` stay null: no site account
			// and no submission produced this revision. It exists so /admin can
			// diff what upstream changed between syncs.
			const { data, error } = await admin
				.from('article_revisions')
				.insert({
					article_id: articleId,
					title: input.title,
					summary: input.summary,
					body_markdown: input.bodySource,
					body_html: input.bodyHtml,
					tags: [],
					vehicle_slugs: null,
					author_display: OFFICIAL_AUTHOR_DISPLAY
				})
				.select('id')
				.single<{ id: string }>();
			if (error || !data) fail('Appending mirrored revision', error);

			const { error: linkError } = await admin
				.from('articles')
				.update({ current_revision_id: data.id })
				.eq('id', articleId);
			if (linkError) fail('Linking mirrored revision', linkError);
		},

		async markChecked(articleId, syncedAt, sourceUpdatedAt) {
			const { error } = await admin
				.from('articles')
				.update({ source_synced_at: syncedAt, source_updated_at: sourceUpdatedAt })
				.eq('id', articleId);
			if (error) fail('Recording patch note sync time', error);
		}
	};
}

/** True for the errors a caller should report as "upstream is unreachable". */
export function isUpstreamError(err: unknown): boolean {
	return err instanceof PatchNoteSourceError;
}

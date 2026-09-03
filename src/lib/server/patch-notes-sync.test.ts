import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	canSkipUpstreamFetch,
	computeMirrorHash,
	MAX_MIRRORED_BODY_CHARS,
	OFFICIAL_AUTHOR_DISPLAY,
	OFFICIAL_SOURCE,
	resolvePublishedAt,
	resolveTarget,
	syncOfficialPatchNotes,
	type MirroredArticleInput,
	type PatchNoteStore,
	type StoredPatchArticle
} from './patch-notes-sync';

const ORIGIN = 'https://www.playtyr.com';
const NOW = new Date('2026-09-03T12:00:00.000Z');

/**
 * In-memory stand-in for the `articles` writes. Records every call so a test
 * can assert on what the sync did *not* do (the important half — mirrored runs
 * are supposed to be quiet).
 */
class FakeStore implements PatchNoteStore {
	rows: StoredPatchArticle[];
	created: MirroredArticleInput[] = [];
	updated: Array<{ id: string; input: MirroredArticleInput }> = [];
	revisions: Array<{ id: string; input: MirroredArticleInput }> = [];
	checked: Array<{ id: string; at: string; sourceUpdatedAt: string | null }> = [];
	private nextId = 1;

	constructor(rows: StoredPatchArticle[] = []) {
		this.rows = rows;
	}

	async listPatchArticles() {
		return this.rows.map((row) => ({ ...row }));
	}

	async createMirroredArticle(input: MirroredArticleInput) {
		const id = `new-${this.nextId++}`;
		this.created.push(input);
		this.rows.push({
			id,
			slug: input.slug,
			status: 'published',
			source: OFFICIAL_SOURCE,
			sourceKey: input.sourceKey,
			sourceHash: input.sourceHash,
			sourceUpdatedAt: input.sourceUpdatedAt
		});
		return id;
	}

	async updateMirroredArticle(id: string, input: MirroredArticleInput) {
		this.updated.push({ id, input });
	}

	async appendRevision(id: string, input: MirroredArticleInput) {
		this.revisions.push({ id, input });
	}

	async markChecked(id: string, at: string, sourceUpdatedAt: string | null) {
		this.checked.push({ id, at, sourceUpdatedAt });
	}

	get writeCount() {
		return this.created.length + this.updated.length + this.revisions.length;
	}
}

function localRow(overrides: Partial<StoredPatchArticle> = {}): StoredPatchArticle {
	return {
		id: 'local-1',
		slug: 'tyr-patch-notes-2026-08-27',
		status: 'published',
		source: 'local',
		sourceKey: null,
		sourceHash: null,
		sourceUpdatedAt: null,
		...overrides
	};
}

function mirroredRow(overrides: Partial<StoredPatchArticle> = {}): StoredPatchArticle {
	return {
		id: 'mirror-1',
		slug: 'tyr-hotfix-2026-08-31',
		status: 'published',
		source: OFFICIAL_SOURCE,
		sourceKey: 'tyr-hotfix-2026-08-31',
		sourceHash: 'stale-hash',
		sourceUpdatedAt: '2026-08-31T22:24:18.597Z',
		...overrides
	};
}

/* ------------------------------------------------------------------ *
 * Upstream doubles
 * ------------------------------------------------------------------ */

interface UpstreamFixture {
	slug: string;
	title: string;
	summary?: string | null;
	version?: string | null;
	markdown?: string;
	releaseDate?: string;
	publishedAt?: string | null;
	updatedAt?: string | null;
}

const DEFAULT_MARKDOWN = '## Bug Fixes\n- Fixed a thing that was broken\n';

/**
 * Serve `__data.json` for an index of the given notes plus a detail payload
 * per note, in the same devalue-flattened shape the real site uses.
 */
function upstreamFetch(notes: UpstreamFixture[]) {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = new URL(String(input));

		if (url.pathname === '/patch-notes/__data.json') {
			const page = Number(url.searchParams.get('page') ?? '1');
			if (page > 1) return new Response('not found', { status: 404 });
			const data: unknown[] = [{ notes: 1, pagination: 2 }, [], { totalPages: 3 }, 1];
			const refs: number[] = [];
			for (const note of notes) {
				refs.push(data.length);
				data.push({
					slug: data.length + 1,
					title: data.length + 2,
					summary: data.length + 3,
					version: data.length + 4,
					release_date: data.length + 5,
					published_at: data.length + 6,
					updated_at: data.length + 7
				});
				data.push(
					note.slug,
					note.title,
					note.summary ?? '',
					note.version ?? '',
					note.releaseDate ?? '2026-08-31',
					note.publishedAt ?? '2026-08-31T22:24:18.535Z',
					note.updatedAt ?? '2026-08-31T22:24:18.597Z'
				);
			}
			data[1] = refs;
			return json({ type: 'data', nodes: [{ type: 'data', data }] });
		}

		const match = url.pathname.match(/^\/patch-notes\/([^/]+)\/__data\.json$/);
		if (match) {
			const note = notes.find((candidate) => candidate.slug === match[1]);
			if (!note) return new Response('not found', { status: 404 });
			return json({
				type: 'data',
				nodes: [
					{
						type: 'data',
						data: [
							{ article: 1 },
							{
								slug: 2,
								title: 3,
								summary: 4,
								version: 5,
								body_markdown: 6,
								release_date: 7,
								published_at: 8,
								updated_at: 9
							},
							note.slug,
							note.title,
							note.summary ?? '',
							note.version ?? '',
							note.markdown ?? DEFAULT_MARKDOWN,
							note.releaseDate ?? '2026-08-31',
							note.publishedAt ?? '2026-08-31T22:24:18.535Z',
							note.updatedAt ?? '2026-08-31T22:24:18.597Z'
						]
					}
				]
			});
		}

		return new Response('not found', { status: 404 });
	});
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function run(store: FakeStore, notes: UpstreamFixture[], options: Record<string, unknown> = {}) {
	return syncOfficialPatchNotes({
		origin: ORIGIN,
		store,
		now: () => NOW,
		fetch: upstreamFetch(notes) as unknown as typeof globalThis.fetch,
		...options
	});
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe('computeMirrorHash', () => {
	const base = {
		title: 'Tyr Hotfix',
		summary: 'Fixes',
		version: null,
		publishedAt: '2026-08-31T00:00:00.000Z',
		bodyHtml: '<p>a</p>'
	};

	it('is stable for identical payloads and moves for any change', () => {
		expect(computeMirrorHash(base)).toBe(computeMirrorHash({ ...base }));
		expect(computeMirrorHash({ ...base, bodyHtml: '<p>b</p>' })).not.toBe(
			computeMirrorHash(base)
		);
		expect(computeMirrorHash({ ...base, title: 'Other' })).not.toBe(computeMirrorHash(base));
	});
});

describe('canSkipUpstreamFetch', () => {
	const stub = {
		sourceKey: 'tyr-hotfix-2026-08-31',
		sourceUrl: `${ORIGIN}/patch-notes/tyr-hotfix-2026-08-31`,
		title: 'Tyr Hotfix',
		summary: null,
		version: null,
		releaseDate: '2026-08-31',
		publishedAt: '2026-08-31T22:24:18.535Z',
		updatedAt: '2026-08-31T22:24:18.597Z'
	};

	it('skips only a mirrored row whose upstream timestamp still matches', () => {
		expect(canSkipUpstreamFetch(mirroredRow(), stub, false)).toBe(true);
		expect(canSkipUpstreamFetch(undefined, stub, false)).toBe(false);
		expect(canSkipUpstreamFetch(localRow({ slug: stub.sourceKey }), stub, false)).toBe(false);
		expect(
			canSkipUpstreamFetch(mirroredRow({ sourceUpdatedAt: '2026-01-01T00:00:00.000Z' }), stub, false)
		).toBe(false);
		expect(canSkipUpstreamFetch(mirroredRow({ sourceHash: null }), stub, false)).toBe(false);
		expect(canSkipUpstreamFetch(mirroredRow(), stub, true)).toBe(false);
	});

	it('never skips when upstream offers no timestamp to compare', () => {
		// The HTML fallback path: no timestamps, so the body must be re-read.
		expect(canSkipUpstreamFetch(mirroredRow(), { ...stub, updatedAt: null }, false)).toBe(false);
	});
});

describe('resolvePublishedAt', () => {
	const stub = {
		sourceKey: 'x',
		sourceUrl: 'x',
		title: 'x',
		summary: null,
		version: null,
		releaseDate: '2026-08-31',
		publishedAt: '2026-08-31T22:24:18.535Z',
		updatedAt: null
	};

	it('prefers the upstream publish time, then the release date, then now', () => {
		expect(resolvePublishedAt(stub, NOW)).toBe('2026-08-31T22:24:18.535Z');
		expect(resolvePublishedAt({ ...stub, publishedAt: null }, NOW)).toBe(
			'2026-08-31T00:00:00.000Z'
		);
		expect(resolvePublishedAt({ ...stub, publishedAt: null, releaseDate: null }, NOW)).toBe(
			NOW.toISOString()
		);
	});
});

describe('resolveTarget', () => {
	const stub = {
		sourceKey: 'tyr-hotfix-2026-08-31',
		sourceUrl: 'x',
		title: 'x',
		summary: null,
		version: null,
		releaseDate: null,
		publishedAt: null,
		updatedAt: null
	};

	function ctx(rows: StoredPatchArticle[], adoptLocal = true) {
		const bySourceKey = new Map<string, StoredPatchArticle>();
		const bySlug = new Map<string, StoredPatchArticle>();
		for (const row of rows) {
			if (row.source === OFFICIAL_SOURCE && row.sourceKey) bySourceKey.set(row.sourceKey, row);
			bySlug.set(row.slug, row);
		}
		return { adoptLocal, bySourceKey, bySlug };
	}

	it('creates when nothing holds the key or the slug', () => {
		expect(resolveTarget(stub, ctx([]))).toEqual({ kind: 'create' });
	});

	it('updates the row already mirroring this upstream key', () => {
		const row = mirroredRow();
		expect(resolveTarget(stub, ctx([row]))).toEqual({ kind: 'update', row });
	});

	it('adopts a locally uploaded row on an exact slug match', () => {
		const row = localRow({ slug: stub.sourceKey });
		expect(resolveTarget(stub, ctx([row]))).toEqual({ kind: 'adopt', row });
	});

	it('leaves a locally uploaded row alone when adoption is off', () => {
		const row = localRow({ slug: stub.sourceKey });
		expect(resolveTarget(stub, ctx([row], false))).toMatchObject({
			kind: 'skip',
			reason: expect.stringContaining('locally uploaded')
		});
	});

	it('skips when another upstream note already holds the slug', () => {
		const row = mirroredRow({ id: 'other', slug: stub.sourceKey, sourceKey: 'a-different-note' });
		expect(resolveTarget(stub, ctx([row]))).toMatchObject({
			kind: 'skip',
			reason: expect.stringContaining('different upstream note')
		});
	});

	it('skips a rename whose destination slug is taken by someone else', () => {
		const mine = mirroredRow({ id: 'mine', slug: 'old-slug' });
		const squatter = localRow({ id: 'squatter', slug: stub.sourceKey });
		expect(resolveTarget(stub, ctx([mine, squatter]))).toMatchObject({
			kind: 'skip',
			reason: expect.stringContaining('already taken')
		});
	});
});

/* ------------------------------------------------------------------ *
 * End-to-end sync behaviour
 * ------------------------------------------------------------------ */

describe('syncOfficialPatchNotes', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('creates a mirrored article with official provenance and a revision', async () => {
		const store = new FakeStore();

		const report = await run(store, [
			{
				slug: 'tyr-hotfix-2026-08-31',
				title: 'Tyr Hotfix - 8/31/26',
				summary: 'Fixes several critical bugs.',
				markdown: '## Bug Fixes\n- Valor can fire again\n'
			}
		]);

		expect(report).toMatchObject({
			origin: ORIGIN,
			checked: 1,
			created: 1,
			updated: 0,
			unchanged: 0,
			failed: 0
		});

		expect(store.created).toHaveLength(1);
		const created = store.created[0]!;
		expect(created).toMatchObject({
			slug: 'tyr-hotfix-2026-08-31',
			title: 'Tyr Hotfix - 8/31/26',
			summary: 'Fixes several critical bugs.',
			sourceKey: 'tyr-hotfix-2026-08-31',
			sourceUrl: `${ORIGIN}/patch-notes/tyr-hotfix-2026-08-31`,
			publishedAt: '2026-08-31T22:24:18.535Z',
			syncedAt: NOW.toISOString()
		});
		expect(created.bodyHtml).toContain('<h2 id="bug-fixes">Bug Fixes</h2>');
		expect(created.bodyHtml).toContain('Valor can fire again');
		// The markdown we rendered from is kept, so an admin can diff it later.
		expect(created.bodySource).toContain('## Bug Fixes');
		expect(store.revisions).toEqual([{ id: 'new-1', input: created }]);
	});

	it('writes nothing when upstream has not changed since the last run', async () => {
		const notes: UpstreamFixture[] = [
			{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }
		];
		const store = new FakeStore();
		await run(store, notes);
		const hash = store.created[0]!.sourceHash;

		// Second run against the same upstream state.
		const second = new FakeStore([mirroredRow({ sourceHash: hash })]);
		const report = await run(second, notes);

		expect(report).toMatchObject({ checked: 1, unchanged: 1, created: 0, updated: 0 });
		expect(second.writeCount).toBe(0);
		// Only the "we looked" bookkeeping is written.
		expect(second.checked).toEqual([
			{
				id: 'mirror-1',
				at: NOW.toISOString(),
				sourceUpdatedAt: '2026-08-31T22:24:18.597Z'
			}
		]);
	});

	it('skips the body fetch entirely when the upstream timestamp is unchanged', async () => {
		const fetchImpl = upstreamFetch([
			{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }
		]);
		const store = new FakeStore([mirroredRow()]);

		await syncOfficialPatchNotes({
			origin: ORIGIN,
			store,
			now: () => NOW,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		const detailCalls = fetchImpl.mock.calls.filter((call) =>
			String(call[0]).includes('/tyr-hotfix-2026-08-31/__data.json')
		);
		expect(detailCalls).toHaveLength(0);
		expect(store.writeCount).toBe(0);
	});

	it('rewrites the article when upstream edits a note', async () => {
		const store = new FakeStore([
			mirroredRow({ sourceUpdatedAt: '2026-08-31T22:24:18.597Z', sourceHash: 'old' })
		]);

		const report = await run(store, [
			{
				slug: 'tyr-hotfix-2026-08-31',
				title: 'Tyr Hotfix - 8/31/26 (revised)',
				markdown: '## Bug Fixes\n- Corrected the earlier note\n',
				updatedAt: '2026-09-01T09:00:00.000Z'
			}
		]);

		expect(report).toMatchObject({ updated: 1, created: 0, unchanged: 0 });
		expect(store.updated).toHaveLength(1);
		expect(store.updated[0]!.id).toBe('mirror-1');
		expect(store.updated[0]!.input.title).toBe('Tyr Hotfix - 8/31/26 (revised)');
		expect(store.updated[0]!.input.sourceUpdatedAt).toBe('2026-09-01T09:00:00.000Z');
		expect(store.revisions).toHaveLength(1);
	});

	it('treats a timestamp bump with identical content as unchanged', async () => {
		const notes: UpstreamFixture[] = [
			{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }
		];
		const first = new FakeStore();
		await run(first, notes);

		const store = new FakeStore([
			mirroredRow({ sourceHash: first.created[0]!.sourceHash, sourceUpdatedAt: 'older' })
		]);
		const report = await run(store, notes);

		expect(report).toMatchObject({ unchanged: 1, updated: 0 });
		expect(store.writeCount).toBe(0);
	});

	it('rewrites regardless of hash when forced', async () => {
		const notes: UpstreamFixture[] = [
			{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }
		];
		const first = new FakeStore();
		await run(first, notes);

		const store = new FakeStore([mirroredRow({ sourceHash: first.created[0]!.sourceHash })]);
		const report = await run(store, notes, { force: true });

		expect(report).toMatchObject({ updated: 1, unchanged: 0 });
		expect(store.updated).toHaveLength(1);
	});

	it('adopts a locally uploaded note that already sits on the upstream slug', async () => {
		const store = new FakeStore([localRow({ slug: 'tyr-hotfix-2026-08-31' })]);

		const report = await run(store, [
			{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }
		]);

		expect(report).toMatchObject({ adopted: 1, created: 0, skipped: 0 });
		expect(store.updated[0]!.id).toBe('local-1');
		expect(store.created).toHaveLength(0);
	});

	it('refuses to overwrite a locally uploaded note when adoption is off', async () => {
		const store = new FakeStore([localRow({ slug: 'tyr-hotfix-2026-08-31' })]);

		const report = await run(
			store,
			[{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix - 8/31/26' }],
			{ adoptLocal: false }
		);

		expect(report).toMatchObject({ skipped: 1, created: 0, updated: 0 });
		expect(report.entries[0]?.reason).toContain('locally uploaded');
		expect(store.writeCount).toBe(0);
	});

	it('records a per-note failure without abandoning the rest of the run', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const notes: UpstreamFixture[] = [
			{ slug: 'broken-note', title: 'Broken' },
			{ slug: 'good-note', title: 'Good' }
		];
		const upstream = upstreamFetch(notes);
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('broken-note')) return new Response('boom', { status: 500 });
			return upstream(input, init);
		});

		const store = new FakeStore();
		const report = await syncOfficialPatchNotes({
			origin: ORIGIN,
			store,
			now: () => NOW,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(report).toMatchObject({ checked: 2, created: 1, failed: 1 });
		expect(report.entries.find((entry) => entry.sourceKey === 'broken-note')).toMatchObject({
			outcome: 'failed'
		});
		expect(store.created[0]!.slug).toBe('good-note');
	});

	it('skips a note whose upstream body is implausibly large', async () => {
		const store = new FakeStore();
		const report = await run(store, [
			{
				slug: 'huge-note',
				title: 'Huge',
				markdown: `# Huge\n${'x'.repeat(MAX_MIRRORED_BODY_CHARS)}`
			}
		]);

		expect(report).toMatchObject({ skipped: 1, created: 0 });
		expect(report.entries[0]?.reason).toContain('over the');
		expect(store.writeCount).toBe(0);
	});

	it('attributes mirrored notes to the studio, never to a site account', async () => {
		// author_display is set by the store layer, so assert the constant the
		// sync hands it and that nothing in the input carries a user id.
		expect(OFFICIAL_AUTHOR_DISPLAY).toBe('Stoke Games');

		const store = new FakeStore();
		await run(store, [{ slug: 'tyr-hotfix-2026-08-31', title: 'Tyr Hotfix' }]);
		expect(Object.keys(store.created[0]!)).not.toContain('authorUserId');
	});
});

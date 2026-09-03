import { describe, expect, it, vi } from 'vitest';

import { INCREMENTAL_PAGES, runPatchNoteSync } from './patch-notes-runner';
import {
	OFFICIAL_SOURCE,
	type MirroredArticleInput,
	type PatchNoteStore,
	type StoredPatchArticle
} from './patch-notes-sync';

const ORIGIN = 'https://www.playtyr.com';

/**
 * Store that records the calls it receives and never fails, so these tests
 * exercise the runner (page budget, concurrency, error mapping) rather than
 * the diff logic — that lives in patch-notes-sync.test.ts.
 */
function fakeStore(rows: StoredPatchArticle[] = []): PatchNoteStore & { creates: number } {
	let creates = 0;
	return {
		get creates() {
			return creates;
		},
		async listPatchArticles() {
			return rows;
		},
		async createMirroredArticle(input: MirroredArticleInput) {
			creates += 1;
			rows.push({
				id: `id-${creates}`,
				slug: input.slug,
				status: 'published',
				source: OFFICIAL_SOURCE,
				sourceKey: input.sourceKey,
				sourceHash: input.sourceHash,
				sourceUpdatedAt: input.sourceUpdatedAt
			});
			return `id-${creates}`;
		},
		async updateMirroredArticle() {},
		async appendRevision() {},
		async markChecked() {}
	};
}

/** Minimal upstream: one note per page, `pages` pages deep. */
function upstream(pages: number) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		const page = Number(url.searchParams.get('page') ?? '1');

		if (url.pathname === '/patch-notes/__data.json') {
			return json({
				type: 'data',
				nodes: [
					{
						type: 'data',
						data: [
							{ notes: 1, pagination: 2 },
							[3],
							{ totalPages: 8 },
							{ slug: 4, title: 5, release_date: 6, updated_at: 7 },
							`note-${page}`,
							`Note ${page}`,
							'2026-08-31',
							`2026-08-31T0${page}:00:00.000Z`,
							pages
						]
					}
				]
			});
		}

		if (/^\/patch-notes\/note-\d+\/__data\.json$/.test(url.pathname)) {
			const key = url.pathname.split('/')[2]!;
			return json({
				type: 'data',
				nodes: [
					{
						type: 'data',
						data: [
							{ article: 1 },
							{ slug: 2, title: 3, body_markdown: 4 },
							key,
							`Note ${key}`,
							'## Fixes\n- Something was fixed\n'
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

describe('runPatchNoteSync', () => {
	it('reads only the newest index page by default', async () => {
		const fetchImpl = upstream(3);
		const store = fakeStore();

		const result = await runPatchNoteSync({}, {
			origin: ORIGIN,
			store,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(result.ok).toBe(true);
		expect(INCREMENTAL_PAGES).toBe(1);
		const indexCalls = fetchImpl.mock.calls.filter((call) =>
			String(call[0]).endsWith('/patch-notes/__data.json')
		);
		expect(indexCalls).toHaveLength(1);
		expect(store.creates).toBe(1);
	});

	it('walks the whole archive when asked for a backfill', async () => {
		const fetchImpl = upstream(3);
		const store = fakeStore();

		const result = await runPatchNoteSync({ full: true }, {
			origin: ORIGIN,
			store,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(result.ok).toBe(true);
		expect(store.creates).toBe(3);
	});

	it('joins a run already in flight instead of starting a second one', async () => {
		const fetchImpl = upstream(1);
		const store = fakeStore();
		const options = {
			origin: ORIGIN,
			store,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		};

		// Kick both off in the same tick, as an impatient double-click would.
		const [first, second] = await Promise.all([
			runPatchNoteSync({}, options),
			runPatchNoteSync({}, options)
		]);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		// One note created, not two, and both callers got the same report.
		expect(store.creates).toBe(1);
		expect(first.ok && second.ok && first.report).toEqual(second.ok && second.report);
	});

	it('reports an unreachable official site as an upstream failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await runPatchNoteSync({}, {
			origin: ORIGIN,
			store: fakeStore(),
			fetch: (async () => new Response('down', { status: 503 })) as typeof globalThis.fetch
		});

		expect(result).toMatchObject({ ok: false, kind: 'upstream' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/Could not read the official patch note index/);
	});

	it('releases the in-flight lock after a failure so the next run proceeds', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const failing = await runPatchNoteSync({}, {
			origin: ORIGIN,
			store: fakeStore(),
			fetch: (async () => new Response('down', { status: 503 })) as typeof globalThis.fetch
		});
		expect(failing.ok).toBe(false);

		const store = fakeStore();
		const recovered = await runPatchNoteSync({}, {
			origin: ORIGIN,
			store,
			fetch: upstream(1) as unknown as typeof globalThis.fetch
		});

		expect(recovered.ok).toBe(true);
		expect(store.creates).toBe(1);
	});
});

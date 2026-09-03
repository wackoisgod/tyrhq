import { describe, expect, it, vi } from 'vitest';

import {
	extractElementInnerHtml,
	fetchPatchNote,
	fetchPatchNoteIndex,
	normalizeSourceKey,
	normalizeTimestamp,
	parseDetailData,
	parseDetailHtml,
	parseIndexData,
	parseIndexHtml,
	PatchNoteSourceError,
	resolvePatchNotesOrigin,
	stripTags,
	unflattenDevalue
} from './patch-notes-source';

const ORIGIN = 'https://www.playtyr.com';

/**
 * Both payloads below are trimmed copies of what
 * https://www.playtyr.com/patch-notes/__data.json actually serves, indices and
 * all. They are written out literally rather than generated so that a change
 * in the real payload shape shows up as a test that no longer matches
 * production, not as a test that agrees with our own encoder.
 */
const INDEX_PAYLOAD = {
	type: 'data',
	nodes: [
		{ type: 'data', data: [{ user: 1 }, null] },
		{
			type: 'data',
			data: [
				{ notes: 1, pagination: 8 },
				[2],
				{
					id: 3,
					slug: 4,
					title: 5,
					summary: 6,
					version: 7,
					hero_image: 7,
					release_date: 9,
					published_at: 10,
					updated_at: 11
				},
				'142093e8-131c-483f-99b6-6e22a4ad4d83',
				'tyr-hotfix-2026-08-31',
				'Tyr Hotfix - 8/31/26',
				'This patch addresses several critical game bugs.',
				'',
				{ page: 12, perPage: 13, totalItems: 14, totalPages: 15 },
				'2026-08-31',
				'2026-08-31T22:24:18.535+00:00',
				'2026-08-31T22:24:18.5972+00:00',
				1,
				5,
				30,
				6
			]
		}
	]
};

const DETAIL_PAYLOAD = {
	type: 'data',
	nodes: [
		{ type: 'data', data: [{ user: 1 }, null] },
		{
			type: 'data',
			data: [
				{ article: 1 },
				{
					id: 2,
					type: 3,
					slug: 4,
					title: 5,
					summary: 6,
					version: 7,
					author: 7,
					hero_image: 7,
					body_markdown: 8,
					body_html: 9,
					status: 10,
					release_date: 11,
					published_at: 12,
					created_at: 13,
					updated_at: 14
				},
				'142093e8-131c-483f-99b6-6e22a4ad4d83',
				'patch',
				'tyr-hotfix-2026-08-31',
				'Tyr Hotfix - 8/31/26',
				'This patch addresses several critical game bugs.',
				'',
				'## Bug Fixes\r\n- Fixed cases where Valor could become unable to fire\r\n',
				'<h2>Bug Fixes</h2>\n<ul>\n<li>Fixed cases where Valor could become unable to fire</li>\n</ul>',
				'published',
				'2026-08-31',
				'2026-08-31T22:24:18.535+00:00',
				'2026-08-31T22:24:12.000324+00:00',
				'2026-08-31T22:24:18.5972+00:00'
			]
		}
	]
};

/** Trimmed copy of the rendered listing, Svelte scoping hashes included. */
const INDEX_HTML = `
<ul class="notes svelte-re41q1"><li><a href="/patch-notes/tyr-hotfix-2026-08-31" class="note svelte-re41q1"><span class="note__ver svelte-re41q1">Update</span> <span class="note__main svelte-re41q1"><span class="note__title svelte-re41q1">Tyr Hotfix - 8/31/26</span> <span class="note__summary svelte-re41q1">This patch addresses several critical game bugs.</span></span> <span class="note__meta svelte-re41q1"><span class="note__date svelte-re41q1">Aug 31, 2026</span></span></a></li><li><a href="/patch-notes/tyr-patch-notes-2026-08-27" class="note svelte-re41q1"><span class="note__ver svelte-re41q1">v1.2.3</span> <span class="note__main svelte-re41q1"><span class="note__title svelte-re41q1">Tyr Patch Notes &amp; Extras - 8/27/26</span></span></a></li></ul>
<nav class="pagination svelte-re41q1"><a class="pagination__page" href="/patch-notes?page=2">2</a><a class="pagination__page" href="/patch-notes?page=6">6</a></nav>
`;

const DETAIL_HTML = `
<main><section class="ph svelte-162svzm"><div class="ph__inner svelte-162svzm"><p class="mk-kicker">Patch Note</p> <h1 class="ph__title svelte-162svzm">Tyr Hotfix - 8/31/26</h1> <p class="ph__sub svelte-162svzm">This patch addresses several critical game bugs.</p></div></section>
<article class="patch svelte-1woa53"><div class="patch__meta svelte-1woa53"><time datetime="2026-08-31">August 31, 2026</time></div> <div class="patch__body svelte-1woa53"><div class="article-body svelte-1tzttwy"><h2>Bug Fixes</h2>
<ul><li>Fixed a thing</li></ul><div class="callout">Nested divs must not truncate the body</div><p>Trailing paragraph</p></div></div></article></main>
`;

describe('unflattenDevalue', () => {
	it('rehydrates the flattened graph, resolving shared references', () => {
		const shared = unflattenDevalue([{ a: 1, b: 1 }, 'same']) as { a: string; b: string };
		expect(shared).toEqual({ a: 'same', b: 'same' });
	});

	it('decodes the negative constants and array holes', () => {
		expect(unflattenDevalue([{ missing: -1 }])).toEqual({ missing: undefined });
		expect(unflattenDevalue([[1, -2, 1], 'x'])).toEqual(['x', undefined, 'x']);
		expect(unflattenDevalue([{ n: -3 }])).toEqual({ n: Number.NaN });
	});

	it('decodes typed encodings', () => {
		const value = unflattenDevalue([{ at: 1 }, ['Date', '2026-08-31T00:00:00.000Z']]) as {
			at: Date;
		};
		expect(value.at).toBeInstanceOf(Date);
		expect(value.at.toISOString()).toBe('2026-08-31T00:00:00.000Z');
	});

	it('rejects payloads it cannot decode instead of yielding undefined', () => {
		expect(() => unflattenDevalue([])).toThrow(PatchNoteSourceError);
		expect(() => unflattenDevalue([{ ref: 99 }])).toThrow(/beyond its length/);
		expect(() => unflattenDevalue([{ v: 1 }, ['Wat', 1]])).toThrow(/unsupported devalue type/);
	});
});

describe('parseIndexData', () => {
	it('reads the notes and page count out of the loader payload', () => {
		const result = parseIndexData(INDEX_PAYLOAD, ORIGIN);

		expect(result.totalPages).toBe(6);
		expect(result.notes).toEqual([
			{
				sourceKey: 'tyr-hotfix-2026-08-31',
				sourceUrl: 'https://www.playtyr.com/patch-notes/tyr-hotfix-2026-08-31',
				title: 'Tyr Hotfix - 8/31/26',
				summary: 'This patch addresses several critical game bugs.',
				// Upstream sends "" for a note with no version label.
				version: null,
				releaseDate: '2026-08-31',
				publishedAt: '2026-08-31T22:24:18.535Z',
				updatedAt: '2026-08-31T22:24:18.597Z'
			}
		]);
	});

	it('throws when the payload carries no notes array', () => {
		const payload = { type: 'data', nodes: [{ type: 'data', data: [{ pagination: 1 }, {}] }] };
		expect(() => parseIndexData(payload, ORIGIN)).toThrow(/no notes array/);
	});

	it('throws on a redirect payload rather than treating it as empty', () => {
		expect(() => parseIndexData({ type: 'redirect', location: '/' }, ORIGIN)).toThrow(
			/redirected/
		);
	});
});

describe('parseIndexHtml', () => {
	it('reads notes and the highest page number out of rendered markup', () => {
		const result = parseIndexHtml(INDEX_HTML, ORIGIN);

		expect(result.totalPages).toBe(6);
		expect(result.notes).toHaveLength(2);
		expect(result.notes[0]).toMatchObject({
			sourceKey: 'tyr-hotfix-2026-08-31',
			title: 'Tyr Hotfix - 8/31/26',
			summary: 'This patch addresses several critical game bugs.'
		});
		// The version chip doubles as a generic "Update" label upstream, so only
		// something that looks like a version is kept.
		expect(result.notes[0]?.version).toBeNull();
		expect(result.notes[1]?.version).toBe('v1.2.3');
		expect(result.notes[1]?.title).toBe('Tyr Patch Notes & Extras - 8/27/26');
	});

	it('throws when the markup holds no patch note links', () => {
		expect(() => parseIndexHtml('<main>Nothing here</main>', ORIGIN)).toThrow(
			/no patch note links/
		);
	});
});

describe('parseDetailData', () => {
	it('renders upstream HTML and keeps its markdown as the source', () => {
		const note = parseDetailData(DETAIL_PAYLOAD, ORIGIN, 'tyr-hotfix-2026-08-31');

		// Upstream's own renderer is the reference, so we mirror its HTML.
		expect(note.body.format).toBe('html');
		expect(note.body.content).toContain('<h2>Bug Fixes</h2>');
		// The markdown still comes along for revision diffs.
		expect(note.markdown).toContain('## Bug Fixes');
		expect(note.title).toBe('Tyr Hotfix - 8/31/26');
		expect(note.updatedAt).toBe('2026-08-31T22:24:18.597Z');
		expect(note.sourceUrl).toBe(
			'https://www.playtyr.com/patch-notes/tyr-hotfix-2026-08-31'
		);
	});

	it('falls back to rendering the markdown when no HTML is offered', () => {
		const payload = {
			type: 'data',
			nodes: [
				{
					type: 'data',
					data: [
						{ article: 1 },
						{ slug: 2, title: 3, body_markdown: 4 },
						'a-note',
						'A note',
						'## Hi\n'
					]
				}
			]
		};
		const note = parseDetailData(payload, ORIGIN, 'a-note');
		// Whitespace around the body is trimmed on the way in.
		expect(note.body).toEqual({ format: 'markdown', content: '## Hi' });
		expect(note.markdown).toBe('## Hi');
	});

	it('throws when the note has no body at all', () => {
		const payload = {
			type: 'data',
			nodes: [{ type: 'data', data: [{ article: 1 }, { slug: 2, title: 3 }, 'a-note', 'A note'] }]
		};
		expect(() => parseDetailData(payload, ORIGIN, 'a-note')).toThrow(/empty body/);
	});
});

describe('parseDetailHtml', () => {
	it('lifts the article body out of the rendered page', () => {
		const note = parseDetailHtml(DETAIL_HTML, ORIGIN, 'tyr-hotfix-2026-08-31');

		expect(note.title).toBe('Tyr Hotfix - 8/31/26');
		expect(note.summary).toBe('This patch addresses several critical game bugs.');
		expect(note.releaseDate).toBe('2026-08-31');
		expect(note.publishedAt).toBe('2026-08-31T00:00:00.000Z');
		expect(note.body.format).toBe('html');
		// The rendered page never exposes markdown, so there is no source to keep.
		expect(note.markdown).toBeNull();
		// Nested divs must not cut the body short.
		expect(note.body.content).toContain('Nested divs must not truncate the body');
		expect(note.body.content).toContain('Trailing paragraph');
	});

	it('throws when the body wrapper is missing', () => {
		expect(() => parseDetailHtml('<main><h1>Nope</h1></main>', ORIGIN, 'x')).toThrow(
			/no article body/
		);
	});
});

describe('extractElementInnerHtml', () => {
	it('tracks nesting of the same tag', () => {
		const html = '<div class="a"><div>one</div><div><div>two</div></div></div><div>after</div>';
		expect(extractElementInnerHtml(html, 'div', 'a')).toBe(
			'<div>one</div><div><div>two</div></div>'
		);
	});

	it('returns null when the class is absent or never closed', () => {
		expect(extractElementInnerHtml('<div class="b">x</div>', 'div', 'a')).toBeNull();
		expect(extractElementInnerHtml('<div class="a">x', 'div', 'a')).toBeNull();
	});
});

describe('normalisation helpers', () => {
	it('accepts upstream slugs and rejects anything we could not use as our own', () => {
		expect(normalizeSourceKey('tyr-hotfix-2026-08-31')).toBe('tyr-hotfix-2026-08-31');
		expect(normalizeSourceKey('Tyr-Hotfix')).toBe('tyr-hotfix');
		expect(normalizeSourceKey('../etc/passwd')).toBeNull();
		expect(normalizeSourceKey('a')).toBeNull();
		expect(normalizeSourceKey('has spaces')).toBeNull();
		expect(normalizeSourceKey(`${'x'.repeat(200)}`)).toBeNull();
	});

	it('normalises timestamps and bare dates, dropping junk', () => {
		expect(normalizeTimestamp('2026-08-31')).toBe('2026-08-31T00:00:00.000Z');
		expect(normalizeTimestamp('2026-08-31T22:24:18.535+00:00')).toBe(
			'2026-08-31T22:24:18.535Z'
		);
		expect(normalizeTimestamp('')).toBeNull();
		expect(normalizeTimestamp('soon')).toBeNull();
	});

	it('strips markup and decodes the entities upstream emits', () => {
		expect(stripTags('<p>A &amp; B <code>-Monitor=&#x3C;index></code></p>')).toBe(
			'A & B -Monitor=<index>'
		);
		expect(stripTags('<script>evil()</script><p>safe</p>')).toBe('safe');
	});
});

describe('resolvePatchNotesOrigin', () => {
	it('defaults to the official site and normalises to an origin', () => {
		expect(resolvePatchNotesOrigin(undefined, undefined)).toBe(ORIGIN);
		expect(resolvePatchNotesOrigin('https://staging.example.com/patch-notes', undefined)).toBe(
			'https://staging.example.com'
		);
		expect(resolvePatchNotesOrigin(undefined, 'http://localhost:5174')).toBe(
			'http://localhost:5174'
		);
	});

	it('rejects a misconfigured origin', () => {
		expect(() => resolvePatchNotesOrigin('not-a-url', undefined)).toThrow(/not a valid URL/);
		expect(() => resolvePatchNotesOrigin('ftp://example.com', undefined)).toThrow(
			/must be http/
		);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function htmlResponse(body: string): Response {
	return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('fetchPatchNoteIndex', () => {
	it('walks every page upstream reports and de-duplicates across them', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const page = Number(new URL(url).searchParams.get('page') ?? '1');
			return jsonResponse(indexPayloadForPage(page));
		});

		const notes = await fetchPatchNoteIndex({
			origin: ORIGIN,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(notes.map((note) => note.sourceKey)).toEqual(['note-page-1', 'note-page-2']);
		// Two pages upstream, so two requests — no blind walk to the page cap.
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('honours maxPages so the scheduled run only reads the newest page', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const page = Number(new URL(String(input)).searchParams.get('page') ?? '1');
			return jsonResponse(indexPayloadForPage(page));
		});

		const notes = await fetchPatchNoteIndex({
			origin: ORIGIN,
			maxPages: 1,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(notes.map((note) => note.sourceKey)).toEqual(['note-page-1']);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('stops when a page count is unknown and a page repeats the first', async () => {
		// The HTML fallback has no page count; upstream ignoring ?page= must not
		// turn the walk into 40 identical requests.
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('__data.json')) return new Response('nope', { status: 500 });
			return htmlResponse(INDEX_HTML);
		});

		const notes = await fetchPatchNoteIndex({
			origin: ORIGIN,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(notes).toHaveLength(2);
		// page 1 (json + html), page 2 (json + html), then stop: nothing new.
		expect(fetchImpl).toHaveBeenCalledTimes(4);
	});

	it('reports both failures when neither the payload nor the HTML can be read', async () => {
		const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));

		await expect(
			fetchPatchNoteIndex({
				origin: ORIGIN,
				fetch: fetchImpl as unknown as typeof globalThis.fetch
			})
		).rejects.toThrow(/Could not read the official patch note index \(page 1\)/);
	});
});

describe('fetchPatchNote', () => {
	it('reads the loader payload when it is available', async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(DETAIL_PAYLOAD));

		const note = await fetchPatchNote('tyr-hotfix-2026-08-31', {
			origin: ORIGIN,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(note.markdown).toContain('## Bug Fixes');
		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			'https://www.playtyr.com/patch-notes/tyr-hotfix-2026-08-31/__data.json'
		);
	});

	it('falls back to scraping the page when the payload is unusable', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).includes('__data.json')) return jsonResponse({ type: 'data', nodes: [] });
			return htmlResponse(DETAIL_HTML);
		});

		const note = await fetchPatchNote('tyr-hotfix-2026-08-31', {
			origin: ORIGIN,
			fetch: fetchImpl as unknown as typeof globalThis.fetch
		});

		expect(note.body.format).toBe('html');
		expect(note.title).toBe('Tyr Hotfix - 8/31/26');
	});
});

function indexPayloadForPage(page: number) {
	const totalPages = 2;
	const key = `note-page-${Math.min(page, totalPages)}`;
	return {
		type: 'data',
		nodes: [
			{
				type: 'data',
				data: [
					{ notes: 1, pagination: 6 },
					[2],
					{ slug: 3, title: 4, release_date: 5, updated_at: 5 },
					key,
					`Note ${key}`,
					'2026-08-31',
					{ totalPages: 7 },
					totalPages
				]
			}
		]
	};
}

/**
 * Opt-in check against the live official site: `PATCH_NOTES_LIVE_TEST=1 npm test`.
 * Skipped by default so the suite stays offline and deterministic, but it is
 * the fastest way to find out that upstream changed shape under us.
 */
describe.skipIf(!process.env.PATCH_NOTES_LIVE_TEST)('live official site', () => {
	it('still serves an index and a readable note', async () => {
		const notes = await fetchPatchNoteIndex({ maxPages: 1 });
		expect(notes.length).toBeGreaterThan(0);

		const note = await fetchPatchNote(notes[0]!.sourceKey);
		expect(note.body.content.length).toBeGreaterThan(50);
	}, 60_000);
});

/**
 * Reads patch notes off the official Tyr site (https://www.playtyr.com/patch-notes).
 *
 * The official site is a SvelteKit app, so every route also serves the loader
 * payload its own client uses for navigation at `<route>/__data.json`. We read
 * that first: it hands us each note's rendered HTML *and* its markdown source,
 * plus real timestamps — far more than reverse-engineering the markup gives us.
 *
 * We mirror their rendered HTML rather than re-rendering their markdown, so our
 * page reads exactly like theirs. Their renderer is more forgiving than
 * CommonMark in places (`**Bold: **x` becomes bold upstream but stays literal
 * under remark), and a mirror that quietly disagrees with the source is worse
 * than one that doesn't. The markdown still comes along as the stored source,
 * so revision diffs in /admin stay readable.
 *
 * Because that payload is a framework detail rather than a published API, both
 * the index and the detail fetch fall back to parsing the rendered HTML.
 * `UpstreamPatchNoteBody` carries the format either way, so the sanitiser knows
 * which pipeline to run.
 *
 * Nothing here writes to the database; `patch-notes-sync.ts` owns that.
 */

import { env as privateEnv } from '$env/dynamic/private';

export const DEFAULT_PATCH_NOTES_ORIGIN = 'https://www.playtyr.com';
export const PATCH_NOTES_PATH = '/patch-notes';

/** Guard against a pagination bug upstream turning a sync into an endless walk. */
const MAX_INDEX_PAGES = 40;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'TyrHQ-PatchNoteSync/1.0 (+https://www.tyrhq.com)';

export class PatchNoteSourceError extends Error {
	readonly url: string;
	readonly cause?: unknown;
	constructor(message: string, url: string, cause?: unknown) {
		super(message);
		this.name = 'PatchNoteSourceError';
		this.url = url;
		this.cause = cause;
	}
}

export interface UpstreamPatchNoteBody {
	format: 'markdown' | 'html';
	content: string;
}

/** What the index gives us: everything except the body. */
export interface UpstreamPatchNoteStub {
	/** Upstream slug — stable, and the segment its permalink is built from. */
	sourceKey: string;
	sourceUrl: string;
	title: string;
	summary: string | null;
	version: string | null;
	/** `YYYY-MM-DD` as published upstream, when present. */
	releaseDate: string | null;
	publishedAt: string | null;
	updatedAt: string | null;
}

export interface UpstreamPatchNote extends UpstreamPatchNoteStub {
	/** What we render. Upstream's own HTML when it offers it. */
	body: UpstreamPatchNoteBody;
	/**
	 * Upstream's markdown source, when the payload includes it. Stored as the
	 * note's `body_markdown` so revision diffs read as prose rather than tags.
	 */
	markdown: string | null;
}

export interface UpstreamIndexPage {
	notes: UpstreamPatchNoteStub[];
	/** Total pages upstream reports, or null when we had to infer from markup. */
	totalPages: number | null;
}

export interface PatchNoteSourceOptions {
	/** Override the official origin (tests, or a staging mirror). */
	origin?: string;
	/** Injected for tests; defaults to the platform `fetch`. */
	fetch?: typeof globalThis.fetch;
}

/**
 * Resolve the origin to scrape. `PATCH_NOTES_SOURCE_ORIGIN` exists so a
 * deployment can point at a staging copy (or a local fixture server) without a
 * code change; unset, we read the live official site.
 */
export function resolvePatchNotesOrigin(
	override?: string,
	envOrigin: string | undefined = privateEnv.PATCH_NOTES_SOURCE_ORIGIN
): string {
	const candidate = (override ?? envOrigin ?? '').trim() || DEFAULT_PATCH_NOTES_ORIGIN;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new PatchNoteSourceError(
			`Patch note source origin is not a valid URL: ${candidate}`,
			candidate
		);
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new PatchNoteSourceError(
			`Patch note source origin must be http(s): ${candidate}`,
			candidate
		);
	}
	return parsed.origin;
}

export function upstreamPatchNoteUrl(origin: string, sourceKey: string): string {
	return `${origin}${PATCH_NOTES_PATH}/${sourceKey}`;
}

/* ------------------------------------------------------------------ *
 * SvelteKit `__data.json` decoding
 * ------------------------------------------------------------------ */

// devalue encodes a value graph as a flat array: index 0 is the root, every
// other number is an index into the same array (so shared/cyclic references
// survive), and a small set of negative numbers stand in for values JSON can't
// carry. Only the subset the official payload actually uses is implemented;
// anything else throws rather than silently decoding to undefined.
const DEVALUE_UNDEFINED = -1;
const DEVALUE_HOLE = -2;
const DEVALUE_NAN = -3;
const DEVALUE_POSITIVE_INFINITY = -4;
const DEVALUE_NEGATIVE_INFINITY = -5;
const DEVALUE_NEGATIVE_ZERO = -6;

/**
 * Rehydrate one devalue-flattened array (the `data` of a SvelteKit
 * `__data.json` node) back into a plain value graph.
 */
export function unflattenDevalue(flat: unknown): unknown {
	if (typeof flat === 'number') return hydrateConstant(flat, flat);
	if (!Array.isArray(flat) || flat.length === 0) {
		throw new PatchNoteSourceError('Upstream data payload is not a devalue array', '');
	}

	const values = flat as unknown[];
	const hydrated = new Array<unknown>(values.length);
	const seen = new Set<number>();

	function hydrate(index: unknown): unknown {
		if (typeof index !== 'number' || !Number.isInteger(index)) {
			throw new PatchNoteSourceError(
				`Upstream data payload has a non-index reference: ${String(index)}`,
				''
			);
		}
		if (index < 0) return hydrateConstant(index, index);
		if (index >= values.length) {
			throw new PatchNoteSourceError(
				`Upstream data payload references index ${index} beyond its length`,
				''
			);
		}
		if (seen.has(index)) return hydrated[index];

		const value = values[index];
		seen.add(index);

		if (!value || typeof value !== 'object') {
			hydrated[index] = value;
			return value;
		}

		if (Array.isArray(value)) {
			// A leading string marks devalue's typed encodings (["Date", …] etc.).
			if (typeof value[0] === 'string') {
				hydrated[index] = hydrateTyped(value, hydrate);
				return hydrated[index];
			}
			const array = new Array<unknown>(value.length);
			hydrated[index] = array;
			for (let i = 0; i < value.length; i++) {
				if (value[i] === DEVALUE_HOLE) continue;
				array[i] = hydrate(value[i]);
			}
			return array;
		}

		const object: Record<string, unknown> = {};
		hydrated[index] = object;
		for (const [key, ref] of Object.entries(value as Record<string, unknown>)) {
			object[key] = hydrate(ref);
		}
		return object;
	}

	return hydrate(0);
}

function hydrateConstant(index: number, raw: number): unknown {
	switch (index) {
		case DEVALUE_UNDEFINED:
			return undefined;
		case DEVALUE_NAN:
			return Number.NaN;
		case DEVALUE_POSITIVE_INFINITY:
			return Number.POSITIVE_INFINITY;
		case DEVALUE_NEGATIVE_INFINITY:
			return Number.NEGATIVE_INFINITY;
		case DEVALUE_NEGATIVE_ZERO:
			return -0;
		default:
			throw new PatchNoteSourceError(
				`Upstream data payload uses an unsupported devalue constant: ${raw}`,
				''
			);
	}
}

function hydrateTyped(value: unknown[], hydrate: (ref: unknown) => unknown): unknown {
	const [type] = value as [string, ...unknown[]];
	switch (type) {
		case 'Date':
			return new Date(String(value[1]));
		case 'Object':
			return Object(value[1]);
		case 'BigInt':
			return String(value[1]);
		case 'null': {
			const object: Record<string, unknown> = Object.create(null);
			for (let i = 1; i < value.length; i += 2) {
				object[String(value[i])] = hydrate(value[i + 1]);
			}
			return object;
		}
		case 'Set':
			return (value.slice(1) as unknown[]).map(hydrate);
		case 'Map': {
			const entries: Array<[unknown, unknown]> = [];
			for (let i = 1; i < value.length; i += 2) {
				entries.push([hydrate(value[i]), hydrate(value[i + 1])]);
			}
			return entries;
		}
		default:
			throw new PatchNoteSourceError(
				`Upstream data payload uses an unsupported devalue type: ${type}`,
				''
			);
	}
}

/**
 * Pull the page data out of a `__data.json` response. SvelteKit ships one node
 * per layout/page in the matched route; the page's own data is the last
 * non-null one, and nodes may also be `{"type":"redirect"}` or an error.
 */
export function extractSvelteKitPageData(payload: unknown): Record<string, unknown> {
	const root = payload as { type?: string; nodes?: unknown[]; location?: string } | null;
	if (!root || typeof root !== 'object') {
		throw new PatchNoteSourceError('Upstream data payload is not an object', '');
	}
	if (root.type === 'redirect') {
		throw new PatchNoteSourceError(
			`Upstream data payload redirected to ${root.location ?? 'an unknown location'}`,
			''
		);
	}
	if (!Array.isArray(root.nodes)) {
		throw new PatchNoteSourceError('Upstream data payload has no nodes', '');
	}

	for (let i = root.nodes.length - 1; i >= 0; i--) {
		const node = root.nodes[i] as { type?: string; data?: unknown } | null;
		if (!node || node.type !== 'data' || node.data === undefined) continue;
		const value = unflattenDevalue(node.data);
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	}

	throw new PatchNoteSourceError('Upstream data payload has no page data node', '');
}

/* ------------------------------------------------------------------ *
 * Normalisation helpers
 * ------------------------------------------------------------------ */

const SOURCE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,119}$/;

function text(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	return String(value).trim();
}

function optionalText(value: unknown): string | null {
	const trimmed = text(value);
	return trimmed ? trimmed : null;
}

/**
 * Upstream slugs become our own article slugs, so they have to survive the
 * same shape check the contribution pipeline applies. A slug we can't use is
 * skipped by name rather than silently mangled.
 */
export function normalizeSourceKey(value: unknown): string | null {
	const raw = text(value).toLowerCase();
	return SOURCE_KEY_RE.test(raw) ? raw : null;
}

/** Accept an ISO timestamp or a bare `YYYY-MM-DD`; anything else is dropped. */
export function normalizeTimestamp(value: unknown): string | null {
	const raw = text(value);
	if (!raw) return null;
	const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeReleaseDate(value: unknown): string | null {
	const raw = text(value);
	if (!raw) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
	const iso = normalizeTimestamp(raw);
	return iso ? iso.slice(0, 10) : null;
}

function stubFromRecord(
	record: Record<string, unknown>,
	origin: string
): UpstreamPatchNoteStub | null {
	const sourceKey = normalizeSourceKey(record.slug ?? record.sourceKey);
	if (!sourceKey) return null;
	const title = optionalText(record.title);
	if (!title) return null;

	return {
		sourceKey,
		sourceUrl: upstreamPatchNoteUrl(origin, sourceKey),
		title,
		summary: optionalText(record.summary),
		version: optionalText(record.version),
		releaseDate: normalizeReleaseDate(record.release_date ?? record.releaseDate),
		publishedAt: normalizeTimestamp(record.published_at ?? record.publishedAt),
		updatedAt: normalizeTimestamp(record.updated_at ?? record.updatedAt)
	};
}

/* ------------------------------------------------------------------ *
 * Index parsing
 * ------------------------------------------------------------------ */

/** Parse the index `__data.json` payload into stubs plus a page count. */
export function parseIndexData(payload: unknown, origin: string): UpstreamIndexPage {
	const data = extractSvelteKitPageData(payload);
	const rawNotes = data.notes ?? data.patchNotes ?? data.items;
	if (!Array.isArray(rawNotes)) {
		throw new PatchNoteSourceError('Upstream index payload has no notes array', origin);
	}

	const notes: UpstreamPatchNoteStub[] = [];
	for (const entry of rawNotes) {
		if (!entry || typeof entry !== 'object') continue;
		const stub = stubFromRecord(entry as Record<string, unknown>, origin);
		if (stub) notes.push(stub);
	}

	const pagination = data.pagination as Record<string, unknown> | undefined;
	const totalPages = Number(pagination?.totalPages);

	return {
		notes,
		totalPages: Number.isInteger(totalPages) && totalPages > 0 ? totalPages : null
	};
}

const INDEX_LINK_RE = /<a\b[^>]*href="\/patch-notes\/([a-z0-9][a-z0-9-]*)"[^>]*>([\s\S]*?)<\/a>/gi;
const PAGE_LINK_RE = /href="\/patch-notes\?(?:[^"]*&(?:amp;)?)?page=(\d{1,3})/gi;

/**
 * Fallback index parser over the rendered listing. Matches on the semantic
 * class names the official markup uses (`note__title`, `note__summary`, …),
 * ignoring the Svelte scoping hash that sits alongside them and changes on
 * every one of their deploys.
 */
export function parseIndexHtml(html: string, origin: string): UpstreamIndexPage {
	const notes: UpstreamPatchNoteStub[] = [];
	const seen = new Set<string>();

	for (const match of html.matchAll(INDEX_LINK_RE)) {
		const sourceKey = normalizeSourceKey(match[1]);
		if (!sourceKey || seen.has(sourceKey)) continue;
		const inner = match[2] ?? '';
		const title = spanText(inner, 'note__title') ?? stripTags(inner);
		if (!title) continue;
		seen.add(sourceKey);

		notes.push({
			sourceKey,
			sourceUrl: upstreamPatchNoteUrl(origin, sourceKey),
			title,
			summary: spanText(inner, 'note__summary'),
			// The listing's version chip doubles as a generic "Update" label, so
			// only keep it when it actually looks like a version.
			version: versionLabel(spanText(inner, 'note__ver')),
			releaseDate: normalizeReleaseDate(attrValue(inner, 'datetime')),
			publishedAt: null,
			updatedAt: null
		});
	}

	if (notes.length === 0) {
		throw new PatchNoteSourceError('Upstream index HTML contained no patch note links', origin);
	}

	let totalPages: number | null = null;
	for (const match of html.matchAll(PAGE_LINK_RE)) {
		const page = Number(match[1]);
		if (Number.isInteger(page) && page > 0) totalPages = Math.max(totalPages ?? 0, page);
	}

	return { notes, totalPages };
}

const VERSION_LABEL_RE = /^v?\d+(\.\d+)*[A-Za-z0-9.\-+]*$/;

function versionLabel(value: string | null): string | null {
	if (!value) return null;
	return VERSION_LABEL_RE.test(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Detail parsing
 * ------------------------------------------------------------------ */

/**
 * Parse a note's `__data.json` payload. Renders from upstream's own HTML when
 * it is offered (see the module header) and keeps the markdown as the source.
 */
export function parseDetailData(
	payload: unknown,
	origin: string,
	expectedKey: string
): UpstreamPatchNote {
	const data = extractSvelteKitPageData(payload);
	const raw = (data.article ?? data.note ?? data.patchNote ?? data) as Record<string, unknown>;
	const stub = stubFromRecord({ ...raw, slug: raw.slug ?? expectedKey }, origin);
	if (!stub) {
		throw new PatchNoteSourceError(
			`Upstream note payload for "${expectedKey}" has no usable slug/title`,
			upstreamPatchNoteUrl(origin, expectedKey)
		);
	}

	const markdown = text(raw.body_markdown ?? raw.bodyMarkdown);
	const bodyHtml = text(raw.body_html ?? raw.bodyHtml);
	if (!markdown && !bodyHtml) {
		throw new PatchNoteSourceError(
			`Upstream note payload for "${expectedKey}" has an empty body`,
			upstreamPatchNoteUrl(origin, expectedKey)
		);
	}

	return {
		...stub,
		body: bodyHtml
			? { format: 'html', content: bodyHtml }
			: { format: 'markdown', content: markdown },
		markdown: markdown || null
	};
}

/**
 * Fallback detail parser. Lifts the rendered body out of the official page's
 * `article-body` wrapper, so the mirror still works if the loader payload
 * moves or changes shape.
 */
export function parseDetailHtml(
	html: string,
	origin: string,
	expectedKey: string
): UpstreamPatchNote {
	const url = upstreamPatchNoteUrl(origin, expectedKey);
	const body = extractElementInnerHtml(html, 'div', 'article-body');
	if (!body || !stripTags(body)) {
		throw new PatchNoteSourceError(
			`Upstream note HTML for "${expectedKey}" has no article body`,
			url
		);
	}

	const title = taggedText(html, 'h1', 'ph__title');
	if (!title) {
		throw new PatchNoteSourceError(`Upstream note HTML for "${expectedKey}" has no title`, url);
	}

	const releaseDate = normalizeReleaseDate(attrValue(html, 'datetime'));

	return {
		sourceKey: expectedKey,
		sourceUrl: url,
		title,
		summary: taggedText(html, 'p', 'ph__sub'),
		version: null,
		releaseDate,
		publishedAt: releaseDate ? normalizeTimestamp(releaseDate) : null,
		updatedAt: null,
		body: { format: 'html', content: body },
		// The rendered page never exposes the markdown source.
		markdown: null
	};
}

/* ------------------------------------------------------------------ *
 * Tiny HTML helpers
 *
 * A full parser would be overkill (and a dependency) for lifting a handful of
 * known fields out of a page we only fall back to. These helpers are
 * deliberately conservative: they match on class names, never on the Svelte
 * scoping hash, and everything they return is re-sanitised downstream before
 * it reaches a reader.
 * ------------------------------------------------------------------ */

function classSelector(className: string): string {
	return `class="[^"]*\\b${className}\\b[^"]*"`;
}

function taggedText(html: string, tag: string, className: string): string | null {
	const re = new RegExp(`<${tag}\\b[^>]*${classSelector(className)}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
	const match = html.match(re);
	return match ? stripTags(match[1] ?? '') || null : null;
}

function spanText(html: string, className: string): string | null {
	return taggedText(html, 'span', className);
}

function attrValue(html: string, attribute: string): string | null {
	const match = html.match(new RegExp(`\\b${attribute}="([^"]*)"`, 'i'));
	return match ? (match[1] ?? '').trim() || null : null;
}

/**
 * Return the inner HTML of the first `<tag class="… className …">`, tracking
 * nesting so a body containing more of the same tag isn't truncated at the
 * first close.
 */
export function extractElementInnerHtml(
	html: string,
	tag: string,
	className: string
): string | null {
	const open = new RegExp(`<${tag}\\b[^>]*${classSelector(className)}[^>]*>`, 'i');
	const start = html.match(open);
	if (!start || start.index === undefined) return null;

	const bodyStart = start.index + start[0].length;
	const scanner = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'gi');
	scanner.lastIndex = bodyStart;

	let depth = 1;
	let match: RegExpExecArray | null;
	while ((match = scanner.exec(html)) !== null) {
		if (match[0].startsWith('</')) {
			depth -= 1;
			if (depth === 0) return html.slice(bodyStart, match.index);
		} else {
			depth += 1;
		}
	}
	return null;
}

/** Strip tags and decode the handful of entities the official markup emits. */
export function stripTags(html: string): string {
	return decodeEntities(
		html
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
			.replace(/<[^>]*>/g, ' ')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“'
};

function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
		if (entity.startsWith('#')) {
			const codePoint = entity[1]?.toLowerCase() === 'x'
				? Number.parseInt(entity.slice(2), 16)
				: Number.parseInt(entity.slice(1), 10);
			if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
			try {
				return String.fromCodePoint(codePoint);
			} catch {
				return whole;
			}
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
	});
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

async function request(
	url: string,
	fetchImpl: typeof globalThis.fetch,
	accept: string
): Promise<string> {
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { accept, 'user-agent': USER_AGENT },
			redirect: 'follow',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (err) {
		throw new PatchNoteSourceError(`Request to ${url} failed`, url, err);
	}
	if (!response.ok) {
		throw new PatchNoteSourceError(`Request to ${url} returned ${response.status}`, url);
	}
	return response.text();
}

async function requestJson(url: string, fetchImpl: typeof globalThis.fetch): Promise<unknown> {
	const body = await request(url, fetchImpl, 'application/json');
	try {
		return JSON.parse(body);
	} catch (err) {
		throw new PatchNoteSourceError(`Response from ${url} was not JSON`, url, err);
	}
}

function indexUrls(origin: string, page: number): { data: string; html: string } {
	const query = page > 1 ? `?page=${page}` : '';
	return {
		data: `${origin}${PATCH_NOTES_PATH}/__data.json${query}`,
		html: `${origin}${PATCH_NOTES_PATH}${query}`
	};
}

/** Fetch one page of the official index, preferring the loader payload. */
export async function fetchPatchNoteIndexPage(
	page: number,
	options: PatchNoteSourceOptions = {}
): Promise<UpstreamIndexPage> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const origin = resolvePatchNotesOrigin(options.origin);
	const { data, html } = indexUrls(origin, page);

	try {
		return parseIndexData(await requestJson(data, fetchImpl), origin);
	} catch (dataError) {
		try {
			return parseIndexHtml(await request(html, fetchImpl, 'text/html'), origin);
		} catch (htmlError) {
			throw new PatchNoteSourceError(
				`Could not read the official patch note index (page ${page}): ` +
					`${describe(dataError)}; HTML fallback: ${describe(htmlError)}`,
				html,
				dataError
			);
		}
	}
}

/** Fetch one note's body, preferring the loader payload's markdown. */
export async function fetchPatchNote(
	sourceKey: string,
	options: PatchNoteSourceOptions = {}
): Promise<UpstreamPatchNote> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const origin = resolvePatchNotesOrigin(options.origin);
	const pageUrl = upstreamPatchNoteUrl(origin, sourceKey);

	try {
		return parseDetailData(
			await requestJson(`${pageUrl}/__data.json`, fetchImpl),
			origin,
			sourceKey
		);
	} catch (dataError) {
		try {
			return parseDetailHtml(
				await request(pageUrl, fetchImpl, 'text/html'),
				origin,
				sourceKey
			);
		} catch (htmlError) {
			throw new PatchNoteSourceError(
				`Could not read the official patch note "${sourceKey}": ` +
					`${describe(dataError)}; HTML fallback: ${describe(htmlError)}`,
				pageUrl,
				dataError
			);
		}
	}
}

/**
 * Walk the whole official index, newest first.
 *
 * `maxPages` bounds the walk for an incremental run (the hourly cron only
 * needs page 1 to notice a new release); a full backfill leaves it unset and
 * follows upstream's own `totalPages`.
 */
export async function fetchPatchNoteIndex(
	options: PatchNoteSourceOptions & { maxPages?: number } = {}
): Promise<UpstreamPatchNoteStub[]> {
	const origin = resolvePatchNotesOrigin(options.origin);
	const limit = Math.min(options.maxPages ?? MAX_INDEX_PAGES, MAX_INDEX_PAGES);

	const collected: UpstreamPatchNoteStub[] = [];
	const seen = new Set<string>();
	let totalPages: number | null = null;

	for (let page = 1; page <= limit; page++) {
		if (totalPages !== null && page > totalPages) break;
		const result = await fetchPatchNoteIndexPage(page, { ...options, origin });
		if (page === 1) totalPages = result.totalPages;

		let added = 0;
		for (const note of result.notes) {
			if (seen.has(note.sourceKey)) continue;
			seen.add(note.sourceKey);
			collected.push(note);
			added += 1;
		}

		// No page count to trust (HTML fallback) and nothing new on this page —
		// upstream is echoing the first page, so stop rather than loop.
		if (added === 0) break;
	}

	return collected;
}

function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

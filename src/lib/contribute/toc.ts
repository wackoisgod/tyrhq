/**
 * Shared table-of-contents helpers for rendered article bodies.
 *
 * This module is environment-agnostic (no DOM, no Node APIs) so it can run on
 * the server while building the SSR table of contents AND on the client when
 * enhancing the live DOM. The server sanitizer (`$lib/server/content-sanitize`)
 * imports the same slugger so the ids it bakes into stored HTML match the ids
 * the client would derive for legacy content that predates id assignment.
 */

export interface TocHeading {
	/** The anchor id used in the URL hash (`#id`). */
	id: string;
	/** Plain-text heading label with inline markup stripped. */
	text: string;
	/** Heading level, 1–6 (the `2` in `<h2>`). */
	level: number;
}

/**
 * Turn heading text into a URL-safe slug. Mirrors `slugify` in the frontmatter
 * sanitizer (lowercase, punctuation collapses to single hyphens) but tolerates
 * empty results by falling back to `section`, since a heading anchor must
 * always resolve to *something*.
 */
export function slugifyHeadingText(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/['"`]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');
	return slug || 'section';
}

/**
 * Returns a stateful function that maps heading text to a unique slug,
 * appending `-2`, `-3`, … when the same slug would otherwise repeat. Walking
 * headings in document order with one deduper instance yields stable,
 * collision-free ids — and the same instance/order on the server and client
 * produces identical ids.
 */
export function createHeadingSlugger(): (text: string) => string {
	const seen = new Map<string, number>();
	return (text: string) => {
		const base = slugifyHeadingText(text);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count + 1}`;
	};
}

const HEADING_RE = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
const ID_ATTR_RE = /\bid="([^"]*)"/i;
const TAG_RE = /<[^>]+>/g;

const ENTITY_MAP: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'",
	'&nbsp;': ' '
};

function decodeBasicEntities(value: string): string {
	return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m);
}

/** Strip inline markup (`<em>`, `<code>`, `<a>`, …) to a clean text label. */
function headingTextFromInnerHtml(inner: string): string {
	return decodeBasicEntities(inner.replace(TAG_RE, '')).replace(/\s+/g, ' ').trim();
}

export interface ExtractHeadingsOptions {
	/** Lowest level included in the TOC (default 2 — `<h2>`). */
	minLevel?: number;
	/** Highest level included in the TOC (default 3 — `<h3>`). */
	maxLevel?: number;
}

/**
 * Parse a block of sanitized article HTML into a flat list of headings for the
 * table of contents. Reuses an id already present on the element; otherwise
 * derives one with the shared slugger so the result matches what the client
 * DOM enhancement assigns. Headings whose text is empty are skipped.
 */
export function extractHeadings(html: string, options: ExtractHeadingsOptions = {}): TocHeading[] {
	const minLevel = options.minLevel ?? 2;
	const maxLevel = options.maxLevel ?? 3;
	if (!html) return [];

	const slugger = createHeadingSlugger();
	const headings: TocHeading[] = [];

	for (const match of html.matchAll(HEADING_RE)) {
		const level = Number(match[1]);
		const attrs = match[2] ?? '';
		const text = headingTextFromInnerHtml(match[3] ?? '');
		if (!text) continue;

		// Advance the slugger for every heading (even out-of-range ones) so the
		// dedupe counters stay aligned with the full document order the DOM
		// enhancement walks.
		const existingId = ID_ATTR_RE.exec(attrs)?.[1]?.trim();
		const derivedId = slugger(text);
		if (level < minLevel || level > maxLevel) continue;

		headings.push({ id: existingId || derivedId, text, level });
	}

	return headings;
}

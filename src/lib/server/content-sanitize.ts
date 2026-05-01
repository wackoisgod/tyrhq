import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node } from 'unist';
import { env as publicEnv } from '$env/dynamic/public';

export const CALLOUT_TYPES = ['info', 'warning', 'tip'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SLUG_RE = /^[a-z0-9-]{3,80}$/;
const TAG_RE = /^[a-z0-9-]{1,32}$/;

export class ContentValidationError extends Error {
	readonly field: string;
	constructor(field: string, message: string) {
		super(message);
		this.field = field;
		this.name = 'ContentValidationError';
	}
}

type DirectiveNode = Node & {
	name: string;
	attributes?: Record<string, string | undefined>;
	children?: Node[];
	type: 'textDirective' | 'leafDirective' | 'containerDirective';
};

const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective']);

/**
 * Walks the MDAST and:
 *   - rejects unknown directives
 *   - validates attributes for the two we allow (`youtube`, `callout`)
 *   - rewrites the directive node into a plain HAST element via the standard
 *     `data.hName` / `data.hProperties` / `data.hChildren` channel that
 *     remark-rehype reads. We emit `<aggro-youtube data-id="..." data-title="...">`
 *     and `<aggro-callout data-type="..." data-title="...">…</aggro-callout>`.
 */
function validateAggroDirectives() {
	return (tree: Root) => {
		visit(tree, (node: Node) => {
			if (!DIRECTIVE_TYPES.has(node.type)) return;

			const directive = node as DirectiveNode;
			const name = directive.name;

			if (name === 'youtube') {
				if (directive.type !== 'leafDirective') {
					throw new ContentValidationError(
						'body',
						'`youtube` must be written as a leaf directive: ::youtube{id="…"}'
					);
				}
				const id = directive.attributes?.id?.trim();
				if (!id) {
					throw new ContentValidationError('body', 'YouTube directive is missing the `id` attribute');
				}
				if (!YOUTUBE_ID_RE.test(id)) {
					throw new ContentValidationError(
						'body',
						`YouTube id "${id}" is not in the expected 11-character format`
					);
				}
				const title = directive.attributes?.title?.trim() || 'YouTube video';

				// Rewrite to <aggro-youtube data-id data-title />
				const data =
					(directive as DirectiveNode & {
						data?: {
							hName?: string;
							hProperties?: Record<string, unknown>;
							hChildren?: unknown[];
						};
					}).data ?? {};
				data.hName = 'aggro-youtube';
				data.hProperties = { 'data-id': id, 'data-title': title };
				data.hChildren = [];
				(directive as DirectiveNode & { data?: unknown }).data = data;
				return;
			}

			if (name === 'callout') {
				if (directive.type !== 'containerDirective') {
					throw new ContentValidationError(
						'body',
						'`callout` must be written as a container directive: :::callout{type="info"} … :::'
					);
				}
				const type = (directive.attributes?.type ?? 'info').trim() as CalloutType;
				if (!(CALLOUT_TYPES as readonly string[]).includes(type)) {
					throw new ContentValidationError(
						'body',
						`Callout type "${type}" is not one of: ${CALLOUT_TYPES.join(', ')}`
					);
				}
				const title = directive.attributes?.title?.trim();

				const data =
					(directive as DirectiveNode & {
						data?: { hName?: string; hProperties?: Record<string, unknown> };
					}).data ?? {};
				data.hName = 'aggro-callout';
				data.hProperties = title
					? { 'data-type': type, 'data-title': title }
					: { 'data-type': type };
				(directive as DirectiveNode & { data?: unknown }).data = data;
				return;
			}

			throw new ContentValidationError(
				'body',
				`Unknown directive ":::${name}". Only :::youtube and :::callout are allowed.`
			);
		});
	};
}

/**
 * Restrict <img src> to our own storage bucket. Inline body images come from
 * the upload endpoint, which only writes to `article-images/` under
 * PUBLIC_SUPABASE_URL — anything else (imgur hotlinks, raw HTML <img> tags
 * pasted into markdown) is a content-validation error.
 *
 * Also strips srcset (we don't generate it; it's an injection vector if
 * accepted blindly) and forces lazy loading + async decoding for everything
 * we accept.
 */
function validateImageSources(allowedPrefix: string) {
	return (tree: Root) => {
		visit(tree as unknown as Node, 'element', (node: Node) => {
			const el = node as Node & {
				tagName?: string;
				properties?: Record<string, unknown> | null;
			};
			if (el.tagName !== 'img') return;
			const props = (el.properties ?? {}) as Record<string, unknown>;
			const src = typeof props.src === 'string' ? props.src : null;
			if (!src || !allowedPrefix || !src.startsWith(allowedPrefix)) {
				throw new ContentValidationError(
					'body',
					'Images must be uploaded via the editor — external URLs are not allowed.'
				);
			}
			delete props.srcSet;
			delete props.srcset;
			props.loading = 'lazy';
			props.decoding = 'async';
			el.properties = props;
		});
	};
}

const ARTICLE_IMAGE_BUCKET_PATH = '/storage/v1/object/public/article-images/';

/**
 * Returns the public URL prefix every uploaded image must start with. Reads
 * lazily so test code can run without `PUBLIC_SUPABASE_URL` set (unit tests
 * pass an explicit prefix to `sanitizeArticleBody`).
 */
export function getArticleImageHostPrefix(): string {
	const base = publicEnv.PUBLIC_SUPABASE_URL;
	if (!base) return '';
	try {
		return new URL(ARTICLE_IMAGE_BUCKET_PATH, base).toString();
	} catch {
		return '';
	}
}

/**
 * Hardened HAST sanitizer schema. Starts from rehype's default (which is the GitHub
 * sanitize schema — already strict, no `<script>`, no `on*` attributes) and adds our
 * two custom elements plus an explicit allow-list for `<img>` attributes (the
 * source itself is gated by `validateImageSources` upstream).
 */
function buildSanitizeSchema(): Schema {
	const tagNames = new Set([...(defaultSchema.tagNames ?? []), 'aggro-youtube', 'aggro-callout']);
	if (!tagNames.has('img')) tagNames.add('img');

	const attributes: Schema['attributes'] = {
		...(defaultSchema.attributes ?? {}),
		'aggro-youtube': [['data-id'], ['data-title']],
		'aggro-callout': [['data-type'], ['data-title']],
		img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding']
	};

	return {
		...defaultSchema,
		tagNames: [...tagNames],
		attributes,
		// Default schema already drops `class`, `style`, `id` for most elements; keep that.
		strip: ['script', 'style']
	};
}

const sanitizeSchema = buildSanitizeSchema();

function buildProcessor(imageHostPrefix: string) {
	return unified()
		.use(remarkParse)
		// remark-gfm enables GitHub-flavored markdown: tables, strikethrough, task lists,
		// autolinks, footnotes. All output is still funnelled through rehype-sanitize, so
		// the new node types only render if their HAST tags are in the allow-list (the
		// default schema already permits table/thead/tbody/tr/th/td/del/input[checkbox]).
		.use(remarkGfm)
		.use(remarkDirective)
		.use(validateAggroDirectives)
		.use(remarkRehype, { allowDangerousHtml: false })
		.use(validateImageSources, imageHostPrefix)
		.use(rehypeSanitize, sanitizeSchema)
		.use(rehypeStringify);
}

let cachedProcessor: ReturnType<typeof buildProcessor> | null = null;
let cachedProcessorPrefix: string | null = null;

function getProcessor(imageHostPrefix: string) {
	if (cachedProcessor && cachedProcessorPrefix === imageHostPrefix) return cachedProcessor;
	cachedProcessor = buildProcessor(imageHostPrefix);
	cachedProcessorPrefix = imageHostPrefix;
	return cachedProcessor;
}

export interface SanitizeResult {
	html: string;
	wordCount: number;
}

/**
 * Render community markdown to safe HTML. Throws ContentValidationError on
 * unknown directives, malformed attributes, or images sourced outside our
 * storage bucket — the caller surfaces these to the contributor with a
 * field-specific error.
 *
 * `imageHostPrefix` overrides the env-derived default; tests use this to
 * exercise image rules without needing PUBLIC_SUPABASE_URL set.
 */
export async function sanitizeArticleBody(
	markdown: string,
	options: { imageHostPrefix?: string } = {}
): Promise<SanitizeResult> {
	const imageHostPrefix = options.imageHostPrefix ?? getArticleImageHostPrefix();
	const file = await getProcessor(imageHostPrefix).process(markdown);
	const html = String(file);

	// Cheap word count for length validation (server-rendered, so we count after
	// HTML stripping to avoid penalising callouts/YouTube wrappers).
	const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
	const wordCount = text.split(/\s+/).filter(Boolean).length;

	return { html, wordCount };
}

/**
 * Frontmatter sanitisation — we run this on every submission before storing,
 * so the content_hash represents what the reviewer will see.
 */
export interface ArticleFrontmatterInput {
	type: 'guide' | 'article';
	title: string;
	summary?: string | null;
	slug?: string | null;
	tags?: string[] | null;
	vehicleSlugs?: string[] | null;
	authorDisplay?: string | null;
}

export interface SanitizedFrontmatter {
	type: 'guide' | 'article';
	title: string;
	summary: string | null;
	slug: string;
	tags: string[];
	vehicleSlugs: string[] | null;
	authorDisplay: string | null;
}

const HTML_TAG_RE = /<[^>]*>/g;
const SCRIPT_OR_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

function stripHtml(value: string): string {
	return value.replace(SCRIPT_OR_STYLE_RE, '').replace(HTML_TAG_RE, '').trim();
}

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/['"`]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export function sanitizeFrontmatter(input: ArticleFrontmatterInput): SanitizedFrontmatter {
	if (input.type !== 'guide' && input.type !== 'article') {
		throw new ContentValidationError('type', 'type must be "guide" or "article"');
	}

	const title = stripHtml(input.title ?? '');
	if (!title) throw new ContentValidationError('title', 'Title is required');
	if (title.length > 200) {
		throw new ContentValidationError('title', 'Title must be 200 characters or fewer');
	}

	const summary = input.summary ? stripHtml(input.summary) : null;
	if (summary && summary.length > 500) {
		throw new ContentValidationError('summary', 'Summary must be 500 characters or fewer');
	}

	const slugRaw = (input.slug && input.slug.trim()) || slugify(title);
	if (!SLUG_RE.test(slugRaw)) {
		throw new ContentValidationError(
			'slug',
			'Slug must be 3–80 characters of lowercase letters, numbers, and hyphens'
		);
	}

	const authorDisplay = input.authorDisplay ? stripHtml(input.authorDisplay) : null;
	if (authorDisplay && authorDisplay.length > 80) {
		throw new ContentValidationError(
			'authorDisplay',
			'Author display name must be 80 characters or fewer'
		);
	}

	const tags = (input.tags ?? [])
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	if (tags.length > 10) {
		throw new ContentValidationError('tags', 'No more than 10 tags allowed');
	}
	for (const tag of tags) {
		if (!TAG_RE.test(tag)) {
			throw new ContentValidationError(
				'tags',
				`Tag "${tag}" must be 1–32 characters of lowercase letters, numbers, and hyphens`
			);
		}
	}

	let vehicleSlugs: string[] | null = null;
	if (input.vehicleSlugs && input.vehicleSlugs.length > 0) {
		const cleaned = input.vehicleSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean);
		if (cleaned.length > 10) {
			throw new ContentValidationError('vehicleSlugs', 'No more than 10 vehicle slugs allowed');
		}
		for (const s of cleaned) {
			if (!TAG_RE.test(s)) {
				throw new ContentValidationError(
					'vehicleSlugs',
					`Vehicle slug "${s}" must be 1–32 characters of lowercase letters, numbers, and hyphens`
				);
			}
		}
		vehicleSlugs = cleaned;
	}

	return {
		type: input.type,
		title,
		summary,
		slug: slugRaw,
		tags,
		vehicleSlugs,
		authorDisplay
	};
}

export function computeContentHash(
	frontmatter: SanitizedFrontmatter,
	bodyHtml: string,
	heroImageUrl: string | null = null
): string {
	const payload = JSON.stringify({
		type: frontmatter.type,
		title: frontmatter.title,
		summary: frontmatter.summary,
		slug: frontmatter.slug,
		tags: frontmatter.tags,
		vehicleSlugs: frontmatter.vehicleSlugs,
		authorDisplay: frontmatter.authorDisplay,
		bodyHtml,
		heroImageUrl
	});
	return createHash('sha256').update(payload).digest('hex');
}

/**
 * Validate a hero/thumbnail URL against the same bucket-prefix rule that
 * `validateImageSources` enforces for inline body images. Returns the
 * trimmed URL, or null when the input is empty.
 *
 * Pass `imageHostPrefix` to override the env-derived default (used by tests).
 */
export function assertHeroImageUrl(
	value: string | null | undefined,
	imageHostPrefix?: string
): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	if (!trimmed) return null;
	if (trimmed.length > 1024) {
		throw new ContentValidationError('heroImageUrl', 'Hero image URL is too long.');
	}
	const prefix = imageHostPrefix ?? getArticleImageHostPrefix();
	if (!prefix || !trimmed.startsWith(prefix)) {
		throw new ContentValidationError(
			'heroImageUrl',
			'Hero image must be uploaded via the editor — external URLs are not allowed.'
		);
	}
	return trimmed;
}

export const BODY_MIN_CHARS = 200;
export const BODY_MAX_CHARS = 30_000;

export function assertBodyLength(markdown: string): void {
	const len = markdown.trim().length;
	if (len < BODY_MIN_CHARS) {
		throw new ContentValidationError(
			'body',
			`Body must be at least ${BODY_MIN_CHARS} characters (currently ${len})`
		);
	}
	if (len > BODY_MAX_CHARS) {
		throw new ContentValidationError(
			'body',
			`Body must be at most ${BODY_MAX_CHARS} characters (currently ${len})`
		);
	}
}

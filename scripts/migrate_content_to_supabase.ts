/**
 * One-shot migration: imports every guide and news markdown file under
 * src/content/{guides,news}/*.md into the Supabase `articles` table and
 * appends an initial `article_revisions` row for each.
 *
 * Required env — read from .env (or .env.local) at the repo root:
 *   PUBLIC_SUPABASE_URL          your-project.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    service-role key (NOT the anon key — the
 *                                migration writes through RLS)
 *
 * Usage:
 *   npm run migrate:content -- [--dry-run] [--force]
 *
 *   --dry-run  parse and sanitise everything but don't insert
 *   --force    overwrite an existing article that already shares (type, slug)
 *
 * Requires Node 20.6+ (uses process.loadEnvFile). Already required by the rest
 * of the project (Vercel adapter is pinned to nodejs22.x).
 *
 * Behaviour:
 *   - Parses YAML frontmatter via gray-matter
 *   - Converts <Youtube id="..." title="..." /> → ::youtube{id="..." title="..."}
 *   - Converts <Callout type="..." title="..."> body </Callout> → :::callout{type="..." title="..."} body :::
 *   - Runs the result through the same sanitiser used on the live site, so
 *     the migrated rows render identically to a fresh contributor submission.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import matter from 'gray-matter';
import { createClient } from '@supabase/supabase-js';

// Load .env (and .env.local if present) before reading process.env.
// Uses Node 20.6+ built-in loadEnvFile — no dotenv dep required.
function loadEnvFiles() {
	const root = path.resolve(import.meta.dirname, '..');
	for (const name of ['.env', '.env.local']) {
		const file = path.join(root, name);
		if (existsSync(file)) {
			try {
				process.loadEnvFile(file);
			} catch (err) {
				console.warn(`Could not load ${name}:`, err);
			}
		}
	}
}
loadEnvFiles();
import {
	sanitizeArticleBody,
	sanitizeFrontmatter,
	computeContentHash,
	type ArticleFrontmatterInput
} from '../src/lib/server/content-sanitize';

interface MigrationOptions {
	dryRun: boolean;
	force: boolean;
}

interface MigrationCandidate {
	type: 'guide' | 'article';
	sourcePath: string;
	defaultDate: string;
	defaultSlug: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv: string[]): MigrationOptions {
	return {
		dryRun: argv.includes('--dry-run'),
		force: argv.includes('--force')
	};
}

function deriveSlugAndDate(filename: string): { slug: string; date: string } {
	const basename = filename.replace(/\.md$/, '');
	const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
	const date = basename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
	return { slug, date };
}

async function discoverFiles(type: 'guide' | 'article'): Promise<MigrationCandidate[]> {
	// Source folders kept their legacy names ('guides' and 'news'); the imported
	// rows still use the new vocabulary ('guide' / 'article').
	const dir = path.join(REPO_ROOT, 'src', 'content', type === 'guide' ? 'guides' : 'news');
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}

	const out: MigrationCandidate[] = [];
	for (const filename of entries) {
		if (!filename.endsWith('.md')) continue;
		const sourcePath = path.join(dir, filename);
		const raw = await readFile(sourcePath, 'utf8');
		const parsed = matter(raw);
		const { slug, date } = deriveSlugAndDate(filename);
		out.push({
			type,
			sourcePath,
			defaultDate: date,
			defaultSlug: slug,
			frontmatter: parsed.data ?? {},
			body: parsed.content ?? ''
		});
	}
	return out;
}

/**
 * Convert legacy Svelte tags into remark-directive syntax. The MVP supports
 * <Youtube id title /> and <Callout type title>...</Callout>; anything else
 * is left as-is and will be flagged by the sanitiser.
 */
function legacyToDirectives(body: string): string {
	let out = body;

	// <Youtube id="…" title="…" />   (self-closing or normal)
	out = out.replace(
		/<Youtube\b([^>]*?)\/?>(?:<\/Youtube>)?/g,
		(_match, attrs: string) => {
			const id = extractAttr(attrs, 'id');
			const title = extractAttr(attrs, 'title');
			if (!id) return _match;
			const titlePart = title ? ` title="${title}"` : '';
			return `::youtube{id="${id}"${titlePart}}`;
		}
	);

	// <Callout type="…" title="…">…</Callout>
	out = out.replace(
		/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g,
		(_match, attrs: string, inner: string) => {
			const type = extractAttr(attrs, 'type') ?? 'info';
			const title = extractAttr(attrs, 'title');
			const titlePart = title ? ` title="${title}"` : '';
			return `:::callout{type="${type}"${titlePart}}\n${inner.trim()}\n:::`;
		}
	);

	return out;
}

function extractAttr(attrs: string, name: string): string | null {
	const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
	const match = attrs.match(re);
	return match?.[1] ?? null;
}

async function buildArticleRow(candidate: MigrationCandidate) {
	const fm = candidate.frontmatter as {
		title?: string;
		summary?: string;
		author?: string;
		tags?: string[];
		vehicleSlugs?: string[];
		date?: string;
		draft?: boolean;
	};

	const sanitized = sanitizeFrontmatter({
		type: candidate.type,
		title: fm.title ?? candidate.defaultSlug,
		summary: fm.summary ?? null,
		slug: candidate.defaultSlug,
		tags: fm.tags ?? [],
		vehicleSlugs: fm.vehicleSlugs ?? null,
		authorDisplay: fm.author ?? null
	} satisfies ArticleFrontmatterInput);

	const bodyMarkdown = legacyToDirectives(candidate.body).trim();
	const { html } = await sanitizeArticleBody(bodyMarkdown);
	const contentHash = computeContentHash(sanitized, html);

	const publishedAt = (fm.date ?? candidate.defaultDate)
		? new Date(fm.date ?? candidate.defaultDate).toISOString()
		: new Date().toISOString();

	return {
		articleInsert: {
			type: sanitized.type,
			slug: sanitized.slug,
			title: sanitized.title,
			summary: sanitized.summary,
			body_markdown: bodyMarkdown,
			body_html: html,
			author_display: sanitized.authorDisplay,
			author_user_id: null as string | null,
			tags: sanitized.tags,
			vehicle_slugs: sanitized.vehicleSlugs,
			status: fm.draft ? 'draft' : 'published',
			published_at: fm.draft ? null : publishedAt
		},
		contentHash,
		bodyMarkdown,
		bodyHtml: html
	};
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		console.error(
			'Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source your .env before running this script.'
		);
		process.exit(1);
	}

	const candidates = [
		...(await discoverFiles('guide')),
		...(await discoverFiles('article'))
	];

	if (candidates.length === 0) {
		console.log('No markdown files to migrate.');
		return;
	}

	console.log(`Discovered ${candidates.length} file(s) to migrate.`);

	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	let inserted = 0;
	let skipped = 0;
	let updated = 0;
	const failures: { sourcePath: string; reason: string }[] = [];

	for (const candidate of candidates) {
		try {
			const built = await buildArticleRow(candidate);
			console.log(
				`  ${candidate.type.padEnd(5)} ${built.articleInsert.slug.padEnd(40)} (${candidate.sourcePath})`
			);

			if (opts.dryRun) {
				continue;
			}

			const { data: existing, error: existingError } = await admin
				.from('articles')
				.select('id')
				.eq('type', built.articleInsert.type)
				.eq('slug', built.articleInsert.slug)
				.maybeSingle<{ id: string }>();

			if (existingError) throw new Error(existingError.message);

			let articleId: string;

			if (existing) {
				if (!opts.force) {
					console.log(`    skipped (already exists; rerun with --force to overwrite)`);
					skipped++;
					continue;
				}
				const { error: updateError } = await admin
					.from('articles')
					.update(built.articleInsert)
					.eq('id', existing.id);
				if (updateError) throw new Error(updateError.message);
				articleId = existing.id;
				updated++;
			} else {
				const { data: inserted_, error: insertError } = await admin
					.from('articles')
					.insert(built.articleInsert)
					.select('id')
					.single<{ id: string }>();
				if (insertError || !inserted_) throw new Error(insertError?.message ?? 'insert failed');
				articleId = inserted_.id;
				inserted++;
			}

			const { data: revision, error: revisionError } = await admin
				.from('article_revisions')
				.insert({
					article_id: articleId,
					title: built.articleInsert.title,
					summary: built.articleInsert.summary,
					body_markdown: built.bodyMarkdown,
					body_html: built.bodyHtml,
					tags: built.articleInsert.tags,
					vehicle_slugs: built.articleInsert.vehicle_slugs,
					author_display: built.articleInsert.author_display,
					created_by: null
				})
				.select('id')
				.single<{ id: string }>();
			if (revisionError || !revision) throw new Error(revisionError?.message ?? 'revision insert failed');

			const { error: linkError } = await admin
				.from('articles')
				.update({ current_revision_id: revision.id })
				.eq('id', articleId);
			if (linkError) throw new Error(linkError.message);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			console.error(`    FAILED: ${reason}`);
			failures.push({ sourcePath: candidate.sourcePath, reason });
		}
	}

	console.log('');
	console.log(
		`Done. inserted=${inserted}, updated=${updated}, skipped=${skipped}, failed=${failures.length}.`
	);
	if (failures.length > 0) {
		console.error('Failures:');
		for (const f of failures) console.error(`  ${f.sourcePath} — ${f.reason}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Unhandled error:', err);
	process.exit(1);
});

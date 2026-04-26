import { describe, expect, it } from 'vitest';
import {
	ContentValidationError,
	sanitizeArticleBody,
	sanitizeFrontmatter,
	slugify,
	computeContentHash,
	assertBodyLength,
	BODY_MIN_CHARS
} from './content-sanitize';

describe('sanitizeArticleBody', () => {
	it('renders ordinary markdown to safe HTML', async () => {
		const { html } = await sanitizeArticleBody('## Heading\n\nA **bold** paragraph.');
		expect(html).toContain('<h2>Heading</h2>');
		expect(html).toContain('<strong>bold</strong>');
	});

	it('drops raw <script> tags entirely', async () => {
		const { html } = await sanitizeArticleBody('hello\n\n<script>alert(1)</script>\n\nworld');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert');
	});

	it('drops on* event handler attributes', async () => {
		const { html } = await sanitizeArticleBody('<img src="x" onerror="alert(1)">');
		expect(html).not.toContain('onerror');
	});

	it('drops <iframe> from raw HTML', async () => {
		const { html } = await sanitizeArticleBody('<iframe src="https://evil.test"></iframe>');
		expect(html).not.toContain('<iframe');
	});

	it('rewrites :::youtube{id="..."} into <aggro-youtube>', async () => {
		const { html } = await sanitizeArticleBody('::youtube{id="dQw4w9WgXcQ"}');
		expect(html).toContain('<aggro-youtube');
		expect(html).toContain('data-id="dQw4w9WgXcQ"');
	});

	it('rejects youtube without an id', async () => {
		await expect(sanitizeArticleBody('::youtube')).rejects.toThrow(ContentValidationError);
	});

	it('rejects youtube with a malformed id', async () => {
		await expect(sanitizeArticleBody('::youtube{id="not-an-id"}')).rejects.toThrow(
			/expected 11-character format/
		);
	});

	it('rewrites :::callout container into <aggro-callout> with body content preserved', async () => {
		const md = ':::callout{type="warning" title="Heads up"}\nWatch your **flank**.\n:::';
		const { html } = await sanitizeArticleBody(md);
		expect(html).toContain('<aggro-callout');
		expect(html).toContain('data-type="warning"');
		expect(html).toContain('data-title="Heads up"');
		expect(html).toContain('<strong>flank</strong>');
	});

	it('rejects callout with an unknown type', async () => {
		const md = ':::callout{type="catastrophe"}\nbody\n:::';
		await expect(sanitizeArticleBody(md)).rejects.toThrow(/info, warning, tip/);
	});

	it('rejects unknown directives', async () => {
		await expect(sanitizeArticleBody(':::evil{}\nstuff\n:::')).rejects.toThrow(/Unknown directive/);
	});

	it('preserves links and lists', async () => {
		const { html } = await sanitizeArticleBody(
			'- one\n- [two](https://example.com)\n- three'
		);
		expect(html).toContain('<ul>');
		expect(html).toContain('<a href="https://example.com">two</a>');
	});

	it('strips javascript: URLs from links', async () => {
		const { html } = await sanitizeArticleBody('[click](javascript:alert(1))');
		// rehype-sanitize defaultSchema drops javascript: from href
		expect(html).not.toMatch(/href="javascript:/i);
	});
});

describe('sanitizeFrontmatter', () => {
	it('accepts a clean guide frontmatter', () => {
		const result = sanitizeFrontmatter({
			type: 'guide',
			title: 'Atlas Frontline Survival',
			summary: 'Hold the line.',
			tags: ['heavy', 'survival'],
			vehicleSlugs: ['atlas']
		});
		expect(result.title).toBe('Atlas Frontline Survival');
		expect(result.slug).toBe('atlas-frontline-survival');
		expect(result.tags).toEqual(['heavy', 'survival']);
		expect(result.vehicleSlugs).toEqual(['atlas']);
	});

	it('strips HTML from title and summary', () => {
		const result = sanitizeFrontmatter({
			type: 'guide',
			title: '<script>alert(1)</script>Hello',
			summary: 'Plain <b>bold</b> text'
		});
		expect(result.title).toBe('Hello');
		expect(result.summary).toBe('Plain bold text');
	});

	it('rejects empty title', () => {
		expect(() => sanitizeFrontmatter({ type: 'guide', title: '   ' })).toThrow(
			/Title is required/
		);
	});

	it('rejects bad tag characters', () => {
		expect(() =>
			sanitizeFrontmatter({ type: 'guide', title: 'X', tags: ['UPPER', 'ok'] })
		).toThrow(/lowercase letters/);
	});

	it('rejects too many tags', () => {
		expect(() =>
			sanitizeFrontmatter({
				type: 'guide',
				title: 'A reasonable title here',
				tags: Array.from({ length: 11 }, (_, i) => `t${i}`)
			})
		).toThrow(/No more than 10 tags/);
	});

	it('derives a clean slug from a messy title', () => {
		// Apostrophes are dropped first so adjacent letters stay joined; other
		// punctuation collapses to a single hyphen.
		expect(slugify("It's a Tank?  Sort of!")).toBe('its-a-tank-sort-of');
	});

	it('rejects an explicit malformed slug', () => {
		expect(() =>
			sanitizeFrontmatter({ type: 'guide', title: 'X', slug: 'NotAllowed' })
		).toThrow(/3.80 characters/);
	});
});

describe('computeContentHash', () => {
	it('is stable for identical input', () => {
		const fm = sanitizeFrontmatter({ type: 'guide', title: 'Foo' });
		expect(computeContentHash(fm, '<p>x</p>')).toBe(computeContentHash(fm, '<p>x</p>'));
	});

	it('changes when body changes', () => {
		const fm = sanitizeFrontmatter({ type: 'guide', title: 'Foo' });
		expect(computeContentHash(fm, '<p>x</p>')).not.toBe(computeContentHash(fm, '<p>y</p>'));
	});
});

describe('assertBodyLength', () => {
	it('rejects bodies under the minimum', () => {
		expect(() => assertBodyLength('too short')).toThrow(/at least/);
	});

	it('accepts a body at exactly the minimum', () => {
		expect(() => assertBodyLength('a'.repeat(BODY_MIN_CHARS))).not.toThrow();
	});
});

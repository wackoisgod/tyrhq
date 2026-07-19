import { describe, expect, it } from 'vitest';
import {
	ContentValidationError,
	sanitizeArticleBody,
	sanitizeFrontmatter,
	slugify,
	computeContentHash,
	assertBodyLength,
	assertHeroImageUrl,
	BODY_MIN_CHARS
} from './content-sanitize';

// Tests that exercise image rules pass an explicit prefix so they don't
// depend on PUBLIC_SUPABASE_URL being set in the test environment.
const TEST_IMAGE_PREFIX = 'https://example.test/storage/v1/object/public/article-images/';

// Same bucket path under the host the project used before moving to a custom
// domain — articles published back then still embed this host.
const LEGACY_IMAGE_PREFIX =
	'https://old-project.supabase.co/storage/v1/object/public/article-images/';

describe('sanitizeArticleBody', () => {
	it('renders ordinary markdown to safe HTML', async () => {
		const { html } = await sanitizeArticleBody('## Heading\n\nA **bold** paragraph.');
		// Headings carry an auto-generated slug id for deep-linking (see TOC feature).
		expect(html).toContain('<h2 id="heading">Heading</h2>');
		expect(html).toContain('<strong>bold</strong>');
	});

	it('drops raw <script> tags entirely', async () => {
		const { html } = await sanitizeArticleBody('hello\n\n<script>alert(1)</script>\n\nworld');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert');
	});

	it('drops on* event handler attributes', async () => {
		const { html } = await sanitizeArticleBody(
			`<img src="${TEST_IMAGE_PREFIX}x.png" onerror="alert(1)">`,
			{ imageHostPrefix: TEST_IMAGE_PREFIX }
		);
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

	it('rewrites inline :stat into a reference-only <aggro-stat> (no value baked in)', async () => {
		const { html } = await sanitizeArticleBody('The Atlas has :stat{tank="atlas" stat="health"} HP.');
		expect(html).toContain('<aggro-stat');
		expect(html).toContain('data-tank="atlas"');
		expect(html).toContain('data-stat="health"');
		expect(html).toContain('data-show="value"');
		// The value itself is never stored — it's resolved live at render time.
		expect(html).toContain('></aggro-stat>');
	});

	it('keeps an explicit :stat show mode', async () => {
		const { html } = await sanitizeArticleBody(':stat{tank="atlas" stat="health" show="label"}');
		expect(html).toContain('data-show="label"');
	});

	it('rejects :stat missing a tank', async () => {
		await expect(sanitizeArticleBody(':stat{stat="health"}')).rejects.toThrow(/`tank` attribute/);
	});

	it('rejects :stat missing a stat', async () => {
		await expect(sanitizeArticleBody(':stat{tank="atlas"}')).rejects.toThrow(/`stat` attribute/);
	});

	it('rejects :stat with an invalid show mode', async () => {
		await expect(
			sanitizeArticleBody(':stat{tank="atlas" stat="health" show="wat"}')
		).rejects.toThrow(/show "wat" must be one of/);
	});

	it('preserves links and lists', async () => {
		const { html } = await sanitizeArticleBody(
			'- one\n- [two](https://example.com)\n- three'
		);
		expect(html).toContain('<ul>');
		expect(html).toContain('<a href="https://example.com">two</a>');
	});

	it('renders GFM tables (pipe syntax) into proper <table> markup', async () => {
		const md = [
			'| Source       | Stacks how                           |',
			'| ------------ | ------------------------------------ |',
			'| Talents      | Same-type percents sum, applied once |',
			'| Enemy armor  | Multiplies in sequence — compounds   |'
		].join('\n');
		const { html } = await sanitizeArticleBody(md);
		expect(html).toContain('<table>');
		expect(html).toContain('<thead>');
		expect(html).toContain('<tbody>');
		expect(html).toContain('<th>Source</th>');
		expect(html).toContain('<td>Talents</td>');
		expect(html).toContain('<td>Multiplies in sequence — compounds</td>');
	});

	it('renders GFM strikethrough', async () => {
		const { html } = await sanitizeArticleBody('~~old value~~');
		expect(html).toContain('<del>old value</del>');
	});

	it('strips javascript: URLs from links', async () => {
		const { html } = await sanitizeArticleBody('[click](javascript:alert(1))');
		// rehype-sanitize defaultSchema drops javascript: from href
		expect(html).not.toMatch(/href="javascript:/i);
	});

	it('assigns slug ids to headings for deep-linking', async () => {
		const { html } = await sanitizeArticleBody('## Frontline Survival\n\nbody\n\n### Loadout');
		expect(html).toContain('<h2 id="frontline-survival">Frontline Survival</h2>');
		expect(html).toContain('<h3 id="loadout">Loadout</h3>');
	});

	it('dedupes ids for repeated heading text', async () => {
		const { html } = await sanitizeArticleBody('## Setup\n\na\n\n## Setup\n\nb');
		expect(html).toContain('id="setup"');
		expect(html).toContain('id="setup-2"');
	});

	it('slugifies heading ids from sanitized text only (no markup leaks in)', async () => {
		const { html } = await sanitizeArticleBody('## Armor *vs* Ammo');
		expect(html).toContain('id="armor-vs-ammo"');
		// the generated id must never contain raw HTML
		expect(html).not.toMatch(/id="[^"]*[<>][^"]*"/);
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

describe('image source validation', () => {
	it('accepts markdown images that point at the configured bucket', async () => {
		const { html } = await sanitizeArticleBody(
			`![ok](${TEST_IMAGE_PREFIX}2026/04/abc.png)`,
			{ imageHostPrefix: TEST_IMAGE_PREFIX }
		);
		expect(html).toContain('<img');
		expect(html).toContain(`src="${TEST_IMAGE_PREFIX}2026/04/abc.png"`);
	});

	it('forces lazy loading and async decoding on accepted images', async () => {
		const { html } = await sanitizeArticleBody(
			`![ok](${TEST_IMAGE_PREFIX}x.png)`,
			{ imageHostPrefix: TEST_IMAGE_PREFIX }
		);
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('decoding="async"');
	});

	it('rejects markdown images with an external URL', async () => {
		await expect(
			sanitizeArticleBody('![bad](https://imgur.com/abc.png)', {
				imageHostPrefix: TEST_IMAGE_PREFIX
			})
		).rejects.toThrow(/uploaded via the editor/);
	});

	it('rejects images when no host prefix is configured', async () => {
		await expect(
			sanitizeArticleBody(`![nope](${TEST_IMAGE_PREFIX}x.png)`, { imageHostPrefix: '' })
		).rejects.toThrow(ContentValidationError);
	});

	it('strips srcset from accepted img tags', async () => {
		const { html } = await sanitizeArticleBody(
			`<img src="${TEST_IMAGE_PREFIX}x.png" srcset="${TEST_IMAGE_PREFIX}y.png 2x">`,
			{ imageHostPrefix: TEST_IMAGE_PREFIX }
		);
		expect(html).not.toMatch(/srcset/i);
	});

	it('rewrites bucket images stored under a legacy host to the current prefix', async () => {
		const { html } = await sanitizeArticleBody(
			`![ok](${LEGACY_IMAGE_PREFIX}2026/06/abc.gif)`,
			{ imageHostPrefix: TEST_IMAGE_PREFIX }
		);
		expect(html).toContain(`src="${TEST_IMAGE_PREFIX}2026/06/abc.gif"`);
		expect(html).not.toContain('old-project.supabase.co');
	});

	it('rejects a bucket-shaped path on a non-https URL', async () => {
		await expect(
			sanitizeArticleBody(
				`![bad](http://old-project.supabase.co/storage/v1/object/public/article-images/x.png)`,
				{ imageHostPrefix: TEST_IMAGE_PREFIX }
			)
		).rejects.toThrow(/uploaded via the editor/);
	});

	it('rejects external hosts whose path is not the bucket path', async () => {
		await expect(
			sanitizeArticleBody('![bad](https://evil.test/article-images/x.png)', {
				imageHostPrefix: TEST_IMAGE_PREFIX
			})
		).rejects.toThrow(/uploaded via the editor/);
	});
});

describe('assertHeroImageUrl', () => {
	it('returns null for empty input', () => {
		expect(assertHeroImageUrl(null, TEST_IMAGE_PREFIX)).toBeNull();
		expect(assertHeroImageUrl('', TEST_IMAGE_PREFIX)).toBeNull();
		expect(assertHeroImageUrl('   ', TEST_IMAGE_PREFIX)).toBeNull();
	});

	it('accepts URLs under the configured prefix', () => {
		const url = `${TEST_IMAGE_PREFIX}2026/04/hero.jpg`;
		expect(assertHeroImageUrl(url, TEST_IMAGE_PREFIX)).toBe(url);
	});

	it('rejects external URLs', () => {
		expect(() => assertHeroImageUrl('https://imgur.com/h.png', TEST_IMAGE_PREFIX)).toThrow(
			ContentValidationError
		);
	});

	it('rewrites a hero URL stored under a legacy host to the current prefix', () => {
		expect(assertHeroImageUrl(`${LEGACY_IMAGE_PREFIX}2026/06/hero.jpg`, TEST_IMAGE_PREFIX)).toBe(
			`${TEST_IMAGE_PREFIX}2026/06/hero.jpg`
		);
	});

	it('rejects when no prefix is configured', () => {
		expect(() => assertHeroImageUrl(`${TEST_IMAGE_PREFIX}x.png`, '')).toThrow(
			ContentValidationError
		);
	});

	it('rejects implausibly long URLs', () => {
		const longUrl = TEST_IMAGE_PREFIX + 'x'.repeat(2000) + '.png';
		expect(() => assertHeroImageUrl(longUrl, TEST_IMAGE_PREFIX)).toThrow(/too long/);
	});
});

describe('computeContentHash with hero image', () => {
	it('changes when the hero image url changes', () => {
		const fm = sanitizeFrontmatter({ type: 'guide', title: 'Foo' });
		const a = computeContentHash(fm, '<p>x</p>', null);
		const b = computeContentHash(fm, '<p>x</p>', `${TEST_IMAGE_PREFIX}h.png`);
		expect(a).not.toBe(b);
	});
});

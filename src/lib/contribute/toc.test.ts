import { describe, expect, it } from 'vitest';
import {
	extractHeadings,
	slugifyHeadingText,
	createHeadingSlugger,
	ensureHeadingIds
} from './toc';

describe('slugifyHeadingText', () => {
	it('lowercases and hyphenates', () => {
		expect(slugifyHeadingText('Frontline Survival')).toBe('frontline-survival');
	});

	it('drops apostrophes and collapses punctuation', () => {
		expect(slugifyHeadingText("It's a Tank?  Sort of!")).toBe('its-a-tank-sort-of');
	});

	it('falls back to "section" for empty or symbol-only text', () => {
		expect(slugifyHeadingText('')).toBe('section');
		expect(slugifyHeadingText('—!!—')).toBe('section');
	});
});

describe('createHeadingSlugger', () => {
	it('dedupes repeated headings with numeric suffixes', () => {
		const slug = createHeadingSlugger();
		expect(slug('Setup')).toBe('setup');
		expect(slug('Setup')).toBe('setup-2');
		expect(slug('Setup')).toBe('setup-3');
	});
});

describe('extractHeadings', () => {
	it('extracts h2/h3 with their baked ids by default', () => {
		const html = '<h2 id="intro">Intro</h2><p>x</p><h3 id="details">Details</h3>';
		expect(extractHeadings(html)).toEqual([
			{ id: 'intro', text: 'Intro', level: 2 },
			{ id: 'details', text: 'Details', level: 3 }
		]);
	});

	it('ignores headings outside the level range but keeps dedupe order aligned', () => {
		// The h1 and the first h2 both slug to "overview"; the h2 must become
		// "overview-2" because the (excluded) h1 already consumed "overview".
		const html = '<h1>Overview</h1><h2>Overview</h2>';
		expect(extractHeadings(html)).toEqual([{ id: 'overview-2', text: 'Overview', level: 2 }]);
	});

	it('derives ids for headings that lack one', () => {
		const html = '<h2>No Id Here</h2>';
		expect(extractHeadings(html)).toEqual([{ id: 'no-id-here', text: 'No Id Here', level: 2 }]);
	});

	it('strips inline markup and decodes entities in the label', () => {
		const html = '<h2 id="t">Armor <em>vs</em> &amp; Ammo</h2>';
		expect(extractHeadings(html)).toEqual([{ id: 't', text: 'Armor vs & Ammo', level: 2 }]);
	});

	it('skips empty headings', () => {
		expect(extractHeadings('<h2></h2><h2 id="real">Real</h2>')).toEqual([
			{ id: 'real', text: 'Real', level: 2 }
		]);
	});

	it('honours a custom level range', () => {
		const html = '<h2 id="a">A</h2><h3 id="b">B</h3><h4 id="c">C</h4>';
		expect(extractHeadings(html, { minLevel: 2, maxLevel: 4 }).map((h) => h.id)).toEqual([
			'a',
			'b',
			'c'
		]);
	});

	it('returns an empty list for empty input', () => {
		expect(extractHeadings('')).toEqual([]);
	});
});

describe('ensureHeadingIds', () => {
	it('injects ids into headings that lack them', () => {
		expect(ensureHeadingIds('<h2>Starting Energy</h2>')).toBe(
			'<h2 id="starting-energy">Starting Energy</h2>'
		);
	});

	it('preserves existing attributes when injecting', () => {
		expect(ensureHeadingIds('<h3 class="x">Energy Zones</h3>')).toBe(
			'<h3 class="x" id="energy-zones">Energy Zones</h3>'
		);
	});

	it('leaves headings that already have an id untouched', () => {
		const html = '<h2 id="custom">Title</h2>';
		expect(ensureHeadingIds(html)).toBe(html);
	});

	it('dedupes repeated heading text', () => {
		expect(ensureHeadingIds('<h2>Setup</h2><h2>Setup</h2>')).toBe(
			'<h2 id="setup">Setup</h2><h2 id="setup-2">Setup</h2>'
		);
	});

	it('produces ids that match what extractHeadings derives', () => {
		const raw = '<h2>Starting Energy</h2><p>x</p><h3>Energy Zones</h3>';
		const withIds = ensureHeadingIds(raw);
		const toc = extractHeadings(raw);
		for (const h of toc) {
			expect(withIds).toContain(`id="${h.id}"`);
		}
	});

	it('returns empty input unchanged', () => {
		expect(ensureHeadingIds('')).toBe('');
	});
});

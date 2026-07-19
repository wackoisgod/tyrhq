/**
 * Client-side heading enhancement for rendered article bodies.
 *
 * Adds a Google-Docs-style "link to this section" affordance: every heading in
 * the body gets a hover anchor that copies a permalink (and updates the URL
 * hash) when clicked. Also backfills `id`s on any heading that lacks one, so
 * legacy content stored before the server started baking ids in is still
 * deep-linkable. The slugger matches `extractHeadings`, so the ids stay
 * consistent with the table of contents.
 */
import { createHeadingSlugger } from './toc';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const ENHANCED_ATTR = 'data-anchored';

const LINK_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5 9.5 6.5"/><path d="M7 4.5 8.2 3.3a2.4 2.4 0 0 1 3.4 3.4L10.4 7.9"/><path d="M9 11.5 7.8 12.7a2.4 2.4 0 0 1-3.4-3.4L5.6 8.1"/></svg>`;

function permalinkFor(id: string): string {
	const { origin, pathname, search } = window.location;
	return `${origin}${pathname}${search}#${id}`;
}

/**
 * Walk every heading in `container`, ensure it has an id, and attach a
 * permalink anchor. Idempotent: headings already processed are skipped, so it
 * is safe to call again after the body HTML changes.
 */
export function enhanceArticleHeadings(container: HTMLElement | null | undefined): void {
	if (typeof window === 'undefined' || !container) return;

	const slugger = createHeadingSlugger();
	const headings = container.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR);

	for (const heading of headings) {
		const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (!text) continue;

		// Advance the slugger for every heading so dedupe counters line up with
		// the server/TOC ordering, even when an id is already present.
		const derivedId = slugger(text);
		if (!heading.id) heading.id = derivedId;

		if (heading.hasAttribute(ENHANCED_ATTR)) continue;
		heading.setAttribute(ENHANCED_ATTR, '');

		const anchor = document.createElement('a');
		anchor.className = 'heading-anchor';
		anchor.href = `#${heading.id}`;
		anchor.setAttribute('aria-label', `Link to section: ${text}`);
		anchor.title = 'Copy link to this section';
		anchor.innerHTML = LINK_ICON;

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			const id = heading.id;
			if (!id) return;

			// Update the URL without a full navigation, then scroll the heading
			// into view (CSS `scroll-behavior: smooth` animates it).
			history.replaceState(null, '', `#${id}`);
			heading.scrollIntoView({ behavior: 'smooth', block: 'start' });

			const link = permalinkFor(id);
			void navigator.clipboard?.writeText(link).then(
				() => flashCopied(anchor),
				() => {
					/* clipboard blocked — the hash update still gives a shareable URL */
				}
			);
		});

		heading.appendChild(anchor);
	}
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

function flashCopied(anchor: HTMLElement): void {
	anchor.classList.add('heading-anchor--copied');
	if (flashTimer) clearTimeout(flashTimer);
	flashTimer = setTimeout(() => anchor.classList.remove('heading-anchor--copied'), 1400);
}

/**
 * Registers the two custom elements that the sanitizer pipeline emits in place
 * of the `:::youtube` and `:::callout` directives. Each element renders the
 * same visual styling as the existing $lib/mdsvex/Youtube.svelte and
 * $lib/mdsvex/Callout.svelte components, but using vanilla DOM so it works
 * inside an `{@html bodyHtml}` block (Svelte components can't be mounted from
 * an HTML string at runtime).
 *
 * Call `registerArticleCustomElements()` once on the client — the layout that
 * wraps article pages does this in onMount.
 *
 * The class definitions live INSIDE the register function: `extends HTMLElement`
 * gets evaluated at class-declaration time, and HTMLElement isn't defined under
 * Node, so any module-top-level class breaks SSR the moment this file is
 * imported. Lazy declaration keeps imports SSR-safe.
 */

const YOUTUBE_TAG = 'aggro-youtube';
const CALLOUT_TAG = 'aggro-callout';

const CALLOUT_STYLES: Record<string, { wrapper: string; label: string }> = {
	info: {
		wrapper: 'border-l-[var(--hud-teal)] bg-[var(--hud-teal)]/10',
		label: 'Info'
	},
	warning: {
		wrapper: 'border-l-[var(--hud-lime)] bg-[var(--hud-lime)]/10',
		label: 'Warning'
	},
	tip: {
		wrapper: 'border-l-[var(--hud-muted)] bg-[var(--hud-panel-mid)]',
		label: 'Tip'
	}
};

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

let registered = false;

export function registerArticleCustomElements() {
	if (typeof window === 'undefined' || registered) return;
	registered = true;

	if (!customElements.get(YOUTUBE_TAG)) {
		class AggroYoutube extends HTMLElement {
			connectedCallback() {
				const id = this.getAttribute('data-id') ?? '';
				const title = this.getAttribute('data-title') ?? 'YouTube video';
				if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
					this.textContent = '';
					return;
				}
				this.innerHTML = `
					<div class="my-6 aspect-video overflow-hidden rounded-sm border border-[rgba(69,73,50,0.4)] bg-black shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
						<iframe
							src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}"
							title="${escapeHtml(title)}"
							frameborder="0"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
							allowfullscreen
							loading="lazy"
							class="h-full w-full"
						></iframe>
					</div>
				`;
			}
		}
		customElements.define(YOUTUBE_TAG, AggroYoutube);
	}

	if (!customElements.get(CALLOUT_TAG)) {
		class AggroCallout extends HTMLElement {
			connectedCallback() {
				const type = (this.getAttribute('data-type') ?? 'info') as keyof typeof CALLOUT_STYLES;
				const variant = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info;
				const title = this.getAttribute('data-title') ?? variant.label;

				// Move existing children into the body container so we don't lose
				// the rendered markdown content the sanitizer placed inside the element.
				const body = document.createElement('div');
				body.className = 'mt-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0';
				while (this.firstChild) body.appendChild(this.firstChild);

				const aside = document.createElement('aside');
				aside.className = `my-6 rounded-sm border-l-2 p-4 ${variant.wrapper}`;

				const label = document.createElement('div');
				label.className =
					'text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]';
				label.textContent = title;

				aside.appendChild(label);
				aside.appendChild(body);
				this.appendChild(aside);
			}
		}
		customElements.define(CALLOUT_TAG, AggroCallout);
	}
}

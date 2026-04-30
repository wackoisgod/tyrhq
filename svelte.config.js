import adapter from '@sveltejs/adapter-vercel';
import { mdsvex } from 'mdsvex';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdsvexExtension = '.md';
const mdsvexLayout = resolve(__dirname, 'src/lib/mdsvex/layout.svelte');

const mdsvexAutoImports = `
	import Youtube from '$lib/mdsvex/Youtube.svelte';
	import Callout from '$lib/mdsvex/Callout.svelte';
`;

/**
 * Injects the auto-imported component list into every markdown file
 * before mdsvex compiles it, so authors can use <Youtube>, <Callout>,
 * etc. without per-file <script> imports.
 */
function mdsvexAutoImportPreprocess() {
	const scriptRe = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/;
	const frontmatterRe = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

	return {
		name: 'mdsvex-auto-import',
		markup({ content, filename }) {
			if (!filename?.endsWith(mdsvexExtension)) return null;

			const existing = content.match(scriptRe);
			if (existing) {
				const merged = `<script>${mdsvexAutoImports}\n${existing[1]}</script>`;
				return { code: content.replace(existing[0], merged) };
			}

			const block = `<script>${mdsvexAutoImports}</script>\n\n`;
			const frontmatter = content.match(frontmatterRe);
			if (frontmatter) {
				return {
					code: frontmatter[0] + block + content.slice(frontmatter[0].length)
				};
			}
			return { code: block + content };
		}
	};
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', mdsvexExtension],
	preprocess: [
		mdsvexAutoImportPreprocess(),
		mdsvex({
			extensions: [mdsvexExtension],
			layout: {
				_: mdsvexLayout
			}
		})
	],
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		csp: {
			mode: 'auto',
			directives: {
				'base-uri': ['self'],
				'connect-src': ['self', 'blob:', 'https://*.supabase.co', 'ws:', 'wss:'],
				'default-src': ['self'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'form-action': ['self'],
				'frame-ancestors': ['none'],
				'frame-src': ['self', 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
				'img-src': ['self', 'blob:', 'data:', 'https://*.ytimg.com', 'https://*.supabase.co'],
				'manifest-src': ['self'],
				'object-src': ['none'],
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'https://fonts.googleapis.com'],
				'style-src-attr': ['unsafe-inline']
			}
		},
		alias: {
			$content: 'src/content',
			$gamedata: 'GameData'
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) => {
			if (filename.includes('node_modules')) return undefined;
			// mdsvex emits Svelte 4 syntax (uses $$props in its layout wrapper),
			// so .md files must compile in legacy mode.
			if (filename.endsWith(mdsvexExtension)) return undefined;
			return { runes: true };
		}
	}
};

export default config;

import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
				'img-src': ['self', 'blob:', 'data:', 'https://*.ytimg.com'],
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
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;

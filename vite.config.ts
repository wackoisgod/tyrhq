import path from 'node:path';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const gameDataAssetsRoot = path.resolve('GameData', 'assets');
const gameDataRoot = path.resolve('GameData');

export default defineConfig({
	server: {
		fs: {
			allow: [gameDataRoot]
		}
	},
	plugins: [
		tailwindcss(),
		viteStaticCopy({
			targets: [
				{
					src: normalizePath(path.join(gameDataAssetsRoot, 'images', '**', '*')),
					dest: 'images'
				},
				{
					src: normalizePath(path.join(gameDataAssetsRoot, 'models', '**', '*')),
					dest: 'models'
				}
			]
		}),
		sveltekit()
	]
});

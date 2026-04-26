import path from 'node:path';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, normalizePath, searchForWorkspaceRoot } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const gameDataAssetsRoot = path.join('GameData', 'assets');
const gameDataRoot = path.resolve('GameData');
const gameDataImagesGlob = normalizePath(path.join(gameDataAssetsRoot, 'images', '**', '*'));
const gameDataModelsGlob = normalizePath(path.join(gameDataAssetsRoot, 'models', '**', '*'));
const gameDataAssetBaseSegments = 3;

export default defineConfig({
	server: {
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd()), gameDataRoot]
		}
	},
	plugins: [
		tailwindcss(),
		viteStaticCopy({
			targets: [
				{
					src: gameDataImagesGlob,
					dest: 'images',
					rename: { stripBase: gameDataAssetBaseSegments }
				},
				{
					src: gameDataModelsGlob,
					dest: 'models',
					rename: { stripBase: gameDataAssetBaseSegments }
				}
			]
		}),
		sveltekit()
	]
});

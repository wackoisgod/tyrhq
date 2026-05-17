import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import assetManifest from '$gamedata/generated/asset-manifest.json';
import { hasMapImages } from '$lib/server/game-assets';
import type { GameDataBundle } from '$lib/types/game';

const projectRoot = process.cwd();
const gameDataRoot = path.join(projectRoot, 'GameData');
const assetsRoot = path.join(gameDataRoot, 'assets');
const runtimePath = path.join(gameDataRoot, 'generated', 'runtime.json');

function readJson<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function getExpectedEffectId(effectPath: string) {
	const fileName = effectPath.split('/').at(-1) ?? effectPath;
	return slugify(fileName.replace(/_C$/, '').replace(/\./g, '-'));
}

function listVehicleArmorIds() {
	const modelsDir = path.join(assetsRoot, 'models', 'vehicles');
	const files = new Set(readdirSync(modelsDir));
	return Array.from(files)
		.filter(
			(fileName) =>
				fileName.endsWith('.glb') &&
				!fileName.endsWith('-visual.glb') &&
				!fileName.includes('-deployed-')
		)
		.map((fileName) => fileName.replace(/\.glb$/, ''))
		.filter(
			(vehicleId) =>
				files.has(`${vehicleId}-visual.glb`) && files.has(`${vehicleId}-armor.json`)
		)
		.sort();
}

function listMapImageIds() {
	const lobbyDir = path.join(assetsRoot, 'images', 'maps', 'lobby');
	const minimapDir = path.join(assetsRoot, 'images', 'maps', 'minimap');
	const lobbyIds = new Set(
		readdirSync(lobbyDir)
			.filter((fileName) => fileName.endsWith('.png'))
			.map((fileName) => fileName.replace(/\.png$/, ''))
	);
	const minimapIds = new Set(
		readdirSync(minimapDir)
			.filter((fileName) => fileName.endsWith('.png'))
			.map((fileName) => fileName.replace(/\.png$/, ''))
	);

	return Array.from(lobbyIds)
		.filter((mapId) => minimapIds.has(mapId))
		.sort();
}

function listVehicleDeployedAnimationIds() {
	const modelsDir = path.join(assetsRoot, 'models', 'vehicles');
	return Array.from(
		new Set(
			readdirSync(modelsDir)
				.filter((fileName) => fileName.endsWith('.glb') && fileName.includes('-deployed-'))
				.map((fileName) => fileName.split('-deployed-', 1)[0])
		)
	).sort();
}

function listAbilityIconIds() {
	const abilityDir = path.join(assetsRoot, 'images', 'abilities');
	return readdirSync(abilityDir)
		.filter((fileName) => fileName.endsWith('.png'))
		.map((fileName) => fileName.replace(/\.png$/, ''))
		.sort();
}

describe('generated data integrity', () => {
	it('keeps runtime references internally consistent', () => {
		const bundle = readJson<GameDataBundle>(runtimePath);
		const effectIds = new Set(bundle.effects.map((effect) => effect.id));
		const vehicleIds = new Set(bundle.vehicles.map((vehicle) => vehicle.id));
		const talentIds = new Set(bundle.talents.map((talent) => talent.id));

		for (const effect of bundle.effects) {
			expect(effect.id).toBe(getExpectedEffectId(effect.path));
		}

		for (const component of bundle.components) {
			for (const effectId of component.effectIds) {
				expect(effectIds.has(effectId)).toBe(true);
			}
		}

		for (const talent of bundle.talents) {
			for (const effectId of talent.effectIds) {
				expect(effectIds.has(effectId)).toBe(true);
			}
		}

		for (const tree of bundle.talentTrees) {
			expect(vehicleIds.has(tree.vehicleId)).toBe(true);
			expect(tree.version).toBeGreaterThan(0);

			for (const node of tree.nodes) {
				expect(talentIds.has(node.talentId)).toBe(true);

				for (const prerequisiteId of node.prerequisiteIds) {
					expect(talentIds.has(prerequisiteId)).toBe(true);
				}
			}
		}
	});

	it('keeps the generated asset manifest aligned with published static assets', () => {
		expect(assetManifest.vehicleArmorIds).toEqual(listVehicleArmorIds());
		expect(assetManifest.vehicleDeployedAnimationIds ?? []).toEqual(
			listVehicleDeployedAnimationIds()
		);
		expect(assetManifest.mapImageIds).toEqual(listMapImageIds());
	});

	it('keeps required map images aligned with runtime ids', () => {
		const bundle = readJson<GameDataBundle>(runtimePath);

		for (const map of bundle.maps) {
			expect(hasMapImages(map.id)).toBe(true);
		}
	});

	it('keeps vehicle ability data and icons aligned with runtime ids', () => {
		const bundle = readJson<GameDataBundle>(runtimePath);
		const abilityIconIds = new Set(listAbilityIconIds());

		for (const vehicle of bundle.vehicles) {
			expect(vehicle.ability.name).not.toBe('');
			expect(vehicle.ability.description).not.toBe('');
			expect(vehicle.ability.icon).not.toBe('');
			expect(abilityIconIds.has(vehicle.id)).toBe(true);
		}
	});
});

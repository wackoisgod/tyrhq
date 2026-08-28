import assetManifest from '$gamedata/generated/asset-manifest.json';

export type GameImageKind = 'vehicle' | 'component' | 'ammo' | 'talent' | 'ability' | 'generic';

const imageIdsByKind: Partial<Record<GameImageKind, ReadonlySet<string>>> = {
	vehicle: new Set(assetManifest.vehicleImageIds ?? []),
	component: new Set(assetManifest.componentIconIds ?? []),
	ammo: new Set(assetManifest.ammoIconIds ?? []),
	talent: new Set(assetManifest.talentIconIds ?? []),
	ability: new Set(assetManifest.abilityIconIds ?? [])
};

const folderByKind: Partial<Record<GameImageKind, string>> = {
	vehicle: 'vehicles',
	component: 'components',
	ammo: 'ammo',
	talent: 'talents',
	ability: 'abilities'
};

/** Return true for unknown/external URLs so the browser can still attempt to load them. */
export function hasGameImageAsset(kind: GameImageKind, src: string) {
	const ids = imageIdsByKind[kind];
	const folder = folderByKind[kind];
	if (!ids || !folder) return true;

	const match = src.match(new RegExp(`/images/${folder}/([^/?#]+)\\.png(?:[?#].*)?$`, 'i'));
	if (!match) return true;
	return ids.has(match[1]);
}
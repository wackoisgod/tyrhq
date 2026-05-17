import assetManifest from '$gamedata/generated/asset-manifest.json';

const vehicleArmorIds = new Set<string>(assetManifest.vehicleArmorIds);
const vehicleDeployedAnimationIds = new Set<string>(
	assetManifest.vehicleDeployedAnimationIds ?? []
);
const mapImageIds = new Set<string>(assetManifest.mapImageIds);

export function hasVehicleArmorAssets(vehicleId: string) {
	return vehicleArmorIds.has(vehicleId);
}

export function hasVehicleDeployedAnimationAssets(vehicleId: string) {
	return vehicleDeployedAnimationIds.has(vehicleId);
}

export function hasMapImages(mapId: string) {
	return mapImageIds.has(mapId);
}

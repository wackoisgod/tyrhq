import assetManifest from '$gamedata/generated/asset-manifest.json';

const vehicleArmorIds = new Set(assetManifest.vehicleArmorIds);
const mapImageIds = new Set(assetManifest.mapImageIds);

export function hasVehicleArmorAssets(vehicleId: string) {
	return vehicleArmorIds.has(vehicleId);
}

export function hasMapImages(mapId: string) {
	return mapImageIds.has(mapId);
}

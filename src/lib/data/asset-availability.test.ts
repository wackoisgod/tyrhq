import { describe, expect, it } from 'vitest';

import { hasGameImageAsset } from './asset-availability';

describe('generated image availability', () => {
	it('uses the manifest for known exported image paths', () => {
		expect(hasGameImageAsset('vehicle', '/images/vehicles/seeker.png')).toBe(true);
		expect(hasGameImageAsset('ammo', '/images/ammo/standard.png')).toBe(true);
		expect(hasGameImageAsset('ammo', '/images/ammo/lockdown.png')).toBe(false);
		expect(hasGameImageAsset('talent', '/images/talents/brawler-talent021.png')).toBe(false);
	});

	it('allows generic and external URLs to load normally', () => {
		expect(hasGameImageAsset('generic', '/custom/image.png')).toBe(true);
		expect(hasGameImageAsset('vehicle', 'https://cdn.example.test/vehicle.png')).toBe(true);
	});
});
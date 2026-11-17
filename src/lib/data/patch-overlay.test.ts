import { describe, expect, it } from 'vitest';

import runtimeData from '$gamedata/generated/runtime.json';
import type { GameDataBundle } from '$lib/types/game';
import { getGameDataBundle } from './game-data';
import { applyPatchOverlay } from './patch-overlay';

const raw = runtimeData as unknown as GameDataBundle;

describe('patch overlay', () => {
	it('carries the 11/9/26 balance patch into the served bundle', () => {
		const bundle = getGameDataBundle();
		expect(bundle.components.find((c) => c.id === 'hullbellows')?.description).toContain('95');
		expect(bundle.vehicles.find((v) => v.slug === 'parallax')?.stats.ShellPenetration).toBe(70);
		expect(bundle.vehicles.find((v) => v.slug === 'valor')?.ability?.description).toContain('160%');
	});

	it('skips patches once the export is newer', () => {
		const newer = structuredClone(raw);
		newer.metadata.sourceChangelist = 99999;
		expect(applyPatchOverlay(newer).applied).toEqual([]);
	});

	it('fails when the export no longer has the old value', () => {
		const changed = structuredClone(raw);
		changed.vehicles.find((v) => v.slug === 'parallax')!.stats.ShellPenetration = 75;
		expect(() => applyPatchOverlay(changed)).toThrow(/ShellPenetration/);
	});
});

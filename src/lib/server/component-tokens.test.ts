import { describe, expect, it } from 'vitest';

import rawComponentData from '$lib/data/raw/ComponentData.json';

import { componentValueTokens, getGameDataBundle } from '$lib/data/game-data';

type RawComponentEntry = {
	Name: string;
	ComponentDescription: string;
};

const tokenPattern = /\{(LevelValue(?:Abs|Percent(?:Multiply(?:Decrease|Increase))?)?)\}/g;

function rawTokensById(): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const entry of rawComponentData as RawComponentEntry[]) {
		const id = entry.Name.split('.').at(-1)?.toLowerCase() ?? '';
		const tokens = Array.from(entry.ComponentDescription.matchAll(tokenPattern), (m) => m[1]);
		map.set(id, tokens);
	}
	return map;
}

describe('componentValueTokens', () => {
	it('matches the placeholder tokens in the raw ComponentData drop', () => {
		const raw = rawTokensById();

		for (const [id, tokens] of raw) {
			const distinct = [...new Set(tokens)];
			// The single-token map design relies on each component using one placeholder kind.
			expect(distinct.length, `${id} mixes placeholder tokens; the map needs reworking`)
				.toBeLessThanOrEqual(1);

			const token = distinct[0];
			if (token && token !== 'LevelValue') {
				expect(componentValueTokens.get(id), `${id} is missing its ${token} map entry`).toBe(
					token
				);
			}
		}
	});

	it('has no entries for components absent from the raw drop', () => {
		const raw = rawTokensById();
		for (const id of componentValueTokens.keys()) {
			expect(raw.has(id), `${id} is not in the raw ComponentData drop`).toBe(true);
		}
	});
});

describe('normalized component descriptions', () => {
	const componentById = new Map(getGameDataBundle().components.map((c) => [c.id, c]));

	it('renders Kinetic Absorber with absolute seconds like the game (no negative sign)', () => {
		const description = componentById.get('kineticabsorber')?.description ?? '';
		expect(description).toContain('by 1 seconds');
		expect(description).not.toContain('-1');
	});

	it('renders Adaptive Hardening as a percentage like the game', () => {
		const description = componentById.get('adaptivehardening')?.description ?? '';
		expect(description).toContain('0.6%');
		expect(description).not.toMatch(/by 0\.01 /);
	});

	it('renders Signature Obscurer spotted-time seconds without a negative sign', () => {
		const description = componentById.get('signatureobscurer')?.description ?? '';
		expect(description).toContain('1.5');
		expect(description).not.toContain('-1.5');
	});
});

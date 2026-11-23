import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import { extractTalentValueTokens } from '$lib/game-engine/component-format';

describe('exported component value tokens', () => {
	const componentById = new Map(getGameDataBundle().components.map((component) => [component.id, component]));

	it('keeps every exported template aligned with its ordered token list', () => {
		for (const component of componentById.values()) {
			const templateTokens = extractTalentValueTokens(component.descriptionTemplate ?? '');
			expect(component.valueTokens ?? [], `${component.id} token drift`).toEqual(templateTokens);
		}
	});

	it('renders newly exported multiplier tokens without a manual id map', () => {
		expect(componentById.get('energyvent')?.description).toContain('by 3.5%');
		expect(componentById.get('energyvent')?.description).not.toContain('by 1.03');
		expect(componentById.get('sidescrapegear')?.description).toContain('by 35%');
		expect(componentById.get('sidescrapegear')?.description).not.toContain('by 1.35');
	});

	it('renders Kinetic Absorber with absolute seconds like the game', () => {
		const component = componentById.get('kineticabsorber')!;
		const description = component.description;
		expect(description).toContain(`by ${Math.abs(component.pointValues[0])} seconds`);
		expect(description).not.toContain('-1');
	});

	it('renders Adaptive Hardening as a percentage like the game', () => {
		const component = componentById.get('adaptivehardening')!;
		const description = component.description ?? '';
		// GameData CL 40062: value changed from 0.006 (0.6%) to 0.003 (0.3%)
		const expectedPercentage = `${(component.pointValues[0] * 100).toFixed(1)}%`;
		expect(description).toContain(expectedPercentage);
		expect(description).not.toMatch(/by 0\.003 /);
	});

	it('renders Signature Obscurer spotted-time seconds without a negative sign', () => {
		const description = componentById.get('signatureobscurer')?.description ?? '';
		expect(description).toContain('1.5');
		expect(description).not.toContain('-1.5');
	});
});

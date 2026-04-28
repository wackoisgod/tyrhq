import { getGameSnapshot } from '$lib/data/game-data';

export type ShellGroup = 'Standard' | 'Specialty';

function classifyShell(ammo: { id: string }): ShellGroup {
	return ammo.id === 'standard' ? 'Standard' : 'Specialty';
}

function countActiveModifiers(modifiers: Record<string, number>) {
	return Object.values(modifiers).reduce((acc, value) => (value === 1 ? acc : acc + 1), 0);
}

export function load() {
	const snapshot = getGameSnapshot();

	const shells = snapshot.ammo
		.filter((ammo) => ammo.id === 'standard' || ammo.selectable)
		.map((ammo) => ({
			...ammo,
			group: classifyShell(ammo),
			modifierCount: countActiveModifiers(ammo.modifiers)
		}));

	return { shells };
}

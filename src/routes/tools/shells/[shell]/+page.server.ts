import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getGameDataBundle, getGameSnapshot } from '$lib/data/game-data';

export type ShellGroup = 'Standard' | 'Specialty';

function classifyShell(ammo: { id: string }): ShellGroup {
	return ammo.id === 'standard' ? 'Standard' : 'Specialty';
}

export const load: PageServerLoad = ({ params }) => {
	const slugOrId = params.shell;
	const bundle = getGameDataBundle();
	const snapshot = getGameSnapshot();

	const shell = bundle.ammo.find(
		(entry) => entry.slug === slugOrId || entry.id === slugOrId
	);

	if (!shell || (shell.id !== 'standard' && !shell.selectable)) error(404, 'Shell not found');

	const group = classifyShell(shell);

	const vehicles = bundle.vehicles
		.filter((vehicle) => vehicle.selectable)
		.map((vehicle) => ({
			id: vehicle.id,
			slug: vehicle.slug,
			name: vehicle.name,
			classLabel: vehicle.classLabel,
			base: {
				damage: Number(vehicle.stats.ShellDamage ?? 0),
				penetration: Number(vehicle.stats.ShellPenetration ?? 0),
				reload: Number(vehicle.stats.ReloadTime ?? 0),
				velocity: Number(vehicle.stats.ShellVelocity ?? 0),
				detection: Number(vehicle.stats.DetectionRadius ?? 0),
				maxSpeed: Number(vehicle.stats.MaxSpeed ?? 0),
				reverseSpeed: Number(vehicle.stats.MaxReverseSpeed ?? 0),
				strafeSpeed: Number(vehicle.stats.MaxStrafingSpeed ?? 0)
			}
		}))
		.sort((left, right) => left.name.localeCompare(right.name));

	const relatedShells = snapshot.ammo
		.filter(
			(entry) =>
				(entry.id === 'standard' || entry.selectable) &&
				classifyShell(entry) === group &&
				entry.id !== shell.id
		)
		.slice(0, 6)
		.map((entry) => ({
			id: entry.id,
			slug: entry.slug,
			displayName: entry.displayName
		}));

	return {
		shell: {
			id: shell.id,
			key: shell.key,
			slug: shell.slug,
			name: shell.name,
			displayName: shell.displayName,
			description: shell.description,
			selectable: shell.selectable,
			canLoadSecondary: shell.canLoadSecondary,
			modifiers: shell.modifiers
		},
		group,
		vehicles,
		relatedShells
	};
};

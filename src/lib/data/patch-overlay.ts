import type { GameDataBundle } from '$lib/types/game';

// Balance changes announced in Steam patch notes that the GameData export does not carry yet.
// Each patch applies only while the export is at or below `upTo`, and checks the old value
// before replacing it, so a newer export replaces it or fails loudly instead of drifting.
type Patch = { name: string; upTo: number; apply: (bundle: GameDataBundle) => void };

function replaceValue<T extends object, K extends keyof T>(obj: T, key: K, from: T[K], to: T[K]) {
	if (JSON.stringify(obj[key]) !== JSON.stringify(from)) {
		throw new Error(
			`patch overlay: ${String(key)} is ${JSON.stringify(obj[key])}, expected ${JSON.stringify(from)}`
		);
	}
	obj[key] = to;
}

function find<T>(items: T[], match: (item: T) => boolean, label: string): T {
	const item = items.find(match);
	if (!item) throw new Error(`patch overlay: ${label} not found`);
	return item;
}

export const PATCHES: Patch[] = [
	{
		name: '11/9/26 balance patch',
		upTo: 37952,
		apply(bundle) {
			const bellows = find(bundle.components, (c) => c.id === 'hullbellows', 'hullbellows');
			replaceValue(bellows, 'pointValues', [85], [95]);
			const parallax = find(bundle.vehicles, (v) => v.slug === 'parallax', 'parallax');
			replaceValue(parallax.stats, 'ShellPenetration', 80, 70);
			const valor = find(bundle.vehicles, (v) => v.slug === 'valor', 'valor').ability;
			const oldHeal = '150% of base Shell Damage';
			if (!valor?.description?.includes(oldHeal)) {
				throw new Error(`patch overlay: Valor heal text is "${valor?.description}"`);
			}
			valor.description = valor.description.replace(oldHeal, '160% of base Shell Damage');
		}
	}
];

export function applyPatchOverlay(raw: GameDataBundle, patches: Patch[] = PATCHES) {
	const bundle = structuredClone(raw);
	const changelist = bundle.metadata?.sourceChangelist ?? 0;
	const applied = patches.filter((patch) => changelist <= patch.upTo);
	for (const patch of applied) patch.apply(bundle);
	return { bundle, applied: applied.map((patch) => patch.name) };
}

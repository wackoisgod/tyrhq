import { getGameDataBundle } from '$lib/data/game-data';
import {
	normalizeShow,
	resolveStatText,
	transformStatRefHtml,
	findStatRefs,
	type ShowMode,
	type StatRef,
	type VehicleLike
} from '$lib/game-engine/stat-ref-format';

/**
 * Live resolution of in-article game-data references against the deployed
 * game-data bundle. The sanitizer stores only the reference
 * (`<aggro-stat data-tank data-stat data-show>`); these helpers fill in the
 * current value at render time, so every page load reflects the latest game
 * data the build shipped with — no article re-edit required.
 */

let vehicleIndex: Map<string, VehicleLike> | null = null;

function getVehicleIndex(): Map<string, VehicleLike> {
	if (!vehicleIndex) {
		vehicleIndex = new Map(
			getGameDataBundle().vehicles.map((vehicle) => [
				vehicle.slug.toLowerCase(),
				{
					name: vehicle.name,
					classLabel: vehicle.classLabel,
					classId: vehicle.classId,
					stats: vehicle.stats
				}
			])
		);
	}
	return vehicleIndex;
}

export type ResolvedStatRef =
	| { ok: true; text: string; title: string }
	| { ok: false; error: string };

/** Resolve a single reference, returning render text or a contributor-facing error. */
export function resolveStatRef(ref: { tank: string; stat: string; show?: string }): ResolvedStatRef {
	const show: ShowMode = normalizeShow(ref.show);
	const vehicle = getVehicleIndex().get(ref.tank.trim().toLowerCase());
	if (!vehicle) {
		return { ok: false, error: `Unknown tank "${ref.tank}" in a :stat reference.` };
	}
	const resolution = resolveStatText(vehicle, ref.stat, show);
	if (!resolution.ok) {
		const error =
			resolution.reason === 'unknown-stat'
				? `Unknown stat "${ref.stat}" in a :stat reference for "${ref.tank}".`
				: `Tank "${vehicle.name}" has no "${ref.stat}" value to reference.`;
		return { ok: false, error };
	}
	return { ok: true, text: resolution.text, title: `${vehicle.name} · ${resolution.label}` };
}

/** Fill every `<aggro-stat>` reference in a rendered body with its live value. */
export function renderGameStatRefs(html: string): string {
	if (!html || !html.includes('<aggro-stat')) return html;
	return transformStatRefHtml(html, (ref: StatRef) => {
		const resolved = resolveStatRef(ref);
		return resolved.ok ? { text: resolved.text, title: resolved.title } : null;
	});
}

/**
 * Validate every reference in a rendered body, returning a list of
 * contributor-facing errors (empty when all references resolve). Used by the
 * submission pipeline so authors catch a bad tank/stat before review.
 */
export function collectStatRefErrors(html: string): string[] {
	if (!html || !html.includes('<aggro-stat')) return [];
	const errors: string[] = [];
	for (const ref of findStatRefs(html)) {
		const resolved = resolveStatRef(ref);
		if (!resolved.ok) errors.push(resolved.error);
	}
	return errors;
}

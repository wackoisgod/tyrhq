import { getGameDataBundle, getGameSnapshot } from '$lib/data/game-data';
import { isConditionalComponent } from '$lib/game-engine/build';

export function load() {
	const snapshot = getGameSnapshot();
	const bundle = getGameDataBundle();

	const recordsById = new Map(bundle.components.map((component) => [component.id, component]));
	const conditionalIds = new Set(
		bundle.components.filter(isConditionalComponent).map((component) => component.id)
	);

	const nativeVehicleCounts = new Map<string, number>();
	for (const vehicle of bundle.vehicles) {
		for (const entry of vehicle.nativeComponents) {
			nativeVehicleCounts.set(entry.componentId, (nativeVehicleCounts.get(entry.componentId) ?? 0) + 1);
		}
	}

	const components = snapshot.components.map((summary) => {
		const record = recordsById.get(summary.id);
		const uniqueTriggers = record ? new Set(record.eventTags).size : 0;
		return {
			...summary,
			triggerCount: uniqueTriggers,
			nativeVehicleCount: nativeVehicleCounts.get(summary.id) ?? 0,
			isConditional: conditionalIds.has(summary.id)
		};
	});

	return {
		components
	};
}

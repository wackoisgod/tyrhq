import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGameDataBundle, getGameSnapshot } from '$lib/data/game-data';
import { isConditionalComponent } from '$lib/game-engine/build';

export const load: PageServerLoad = ({ params }) => {
	const slugOrId = params.component;
	const bundle = getGameDataBundle();
	const snapshot = getGameSnapshot();

	const component = bundle.components.find(
		(entry) => entry.slug === slugOrId || entry.id === slugOrId
	);

	if (!component) {
		throw error(404, 'Component not found');
	}

	const effectsById = new Map(bundle.effects.map((effect) => [effect.id, effect]));
	const linkedEffects = component.effectIds
		.map((id) => effectsById.get(id))
		.filter((effect): effect is NonNullable<typeof effect> => Boolean(effect));

	const nativeVehicles = bundle.vehicles
		.flatMap((vehicle) => {
			const native = vehicle.nativeComponents.find(
				(entry) => entry.componentId === component.id
			);
			if (!native) return [];
			return [
				{
					id: vehicle.id,
					slug: vehicle.slug,
					name: vehicle.name,
					classLabel: vehicle.classLabel,
					level: native.level
				}
			];
		})
		.sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));

	const relatedComponents = snapshot.components
		.filter(
			(entry) => entry.categoryId === component.categoryId && entry.id !== component.id
		)
		.slice(0, 6);

	return {
		component: {
			id: component.id,
			slug: component.slug,
			name: component.name,
			description: component.description,
			category: component.category,
			categoryId: component.categoryId,
			pointValues: component.pointValues,
			eventTags: [...new Set(component.eventTags)],
			effectPaths: component.effectPaths,
			isConditional: isConditionalComponent(component)
		},
		linkedEffects,
		nativeVehicles,
		relatedComponents
	};
};

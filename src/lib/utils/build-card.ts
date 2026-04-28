import { getGameSnapshot } from '$lib/data/game-data';

type BuildSelection = {
	componentIds?: string[];
	ammoIds?: string[];
	talentPoints?: Record<string, number>;
};

type ProfileRef = { display_name: string } | { display_name: string }[] | null;

export type RawBuildRow = {
	slug: string;
	title: string;
	vehicle_id: string;
	star_count: number;
	updated_at: string;
	selection: BuildSelection | null;
	profiles: ProfileRef;
};

export type BuildCardData = {
	slug: string;
	title: string;
	vehicleId: string;
	vehicleName: string;
	isAlphaProgram: boolean;
	starCount: number;
	updatedLabel: string;
	author: string;
	components: { id: string; name: string; forceFallback: boolean }[];
	ammo: { id: string; name: string }[];
};

export function toBuildCardData(rows: RawBuildRow[]): BuildCardData[] {
	const snapshot = getGameSnapshot();
	const componentById = new Map(snapshot.components.map((c) => [c.id, c]));
	const ammoById = new Map(snapshot.ammo.map((a) => [a.id, a]));

	return rows.map((b) => {
		const tank = snapshot.tanks.find((t) => t.id === b.vehicle_id);
		const sel = b.selection;
		const componentIds = (sel?.componentIds ?? []).filter(Boolean);
		const ammoIds = (sel?.ammoIds ?? []).filter((id) => {
			if (!id || id === 'standard') return false;
			return Boolean(ammoById.get(id)?.selectable);
		});
		const components = componentIds.map((id) => {
			const component = componentById.get(id);
			return {
				id,
				name: component?.name ?? `Removed component: ${id}`,
				forceFallback: !component
			};
		});
		const ammo = ammoIds.map((id) => {
			const ammoItem = ammoById.get(id);
			return {
				id,
				name: ammoItem?.displayName ?? id
			};
		});

		return {
			slug: b.slug,
			title: b.title,
			vehicleId: b.vehicle_id,
			vehicleName: tank?.name ?? b.vehicle_id,
			isAlphaProgram: tank?.isWorkInProgress ?? false,
			starCount: b.star_count,
			updatedLabel: new Date(b.updated_at).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric'
			}),
			author:
				(Array.isArray(b.profiles) ? b.profiles[0]?.display_name : b.profiles?.display_name) ??
				'Anonymous',
			components,
			ammo
		};
	});
}

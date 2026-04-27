import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { DEFAULT_BUILD_TITLE, MAX_BUILD_TITLE_LENGTH } from '$lib/builds/constants';
import { getGameDataBundle } from '$lib/data/game-data';
import {
	MAX_TOTAL_TALENT_POINTS,
	createPlannerCatalog,
	getPlannerTalentsForVehicle,
	getPointsSpentInTiersBelow,
	getTalentTierUnlockRequirement,
	type PlannerSelection,
	talentPrerequisitesSatisfied
} from '$lib/game-engine/build';

const catalog = createPlannerCatalog(getGameDataBundle());

const selectionSchema = z
	.object({
		vehicleId: z.string().min(1, 'selection.vehicleId is required'),
		ammoIds: z.array(z.string().min(1, 'Ammo slots cannot be empty')),
		previewAmmoSlot: z.number().int().nonnegative('previewAmmoSlot must be 0 or greater'),
		componentIds: z.array(z.string()),
		talentPoints: z.record(
			z.string(),
			z.number().int('Talent points must be whole numbers').positive('Talent points must be positive')
		)
	})
	.strict()
	.superRefine((selection, ctx) => {
		const vehicle = catalog.vehicleById.get(selection.vehicleId);
		if (!vehicle) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['vehicleId'],
				message: 'Unknown selection.vehicleId'
			});
			return;
		}

		if (selection.ammoIds.length !== vehicle.loadout.ammoSlotCount) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['ammoIds'],
				message: `Expected ${vehicle.loadout.ammoSlotCount} ammo slots for ${vehicle.id}`
			});
		}

		if (selection.componentIds.length !== vehicle.loadout.componentSlotCount) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['componentIds'],
				message: `Expected ${vehicle.loadout.componentSlotCount} component slots for ${vehicle.id}`
			});
		}

		if (selection.previewAmmoSlot >= selection.ammoIds.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['previewAmmoSlot'],
				message: 'previewAmmoSlot must reference an existing ammo slot'
			});
		}

		for (const [slotIndex, ammoId] of selection.ammoIds.entries()) {
			const ammo = catalog.ammoById.get(ammoId);
			if (!ammo || (ammo.id !== 'standard' && !ammo.selectable)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['ammoIds', slotIndex],
					message: `Unknown ammoId "${ammoId}"`
				});
				continue;
			}

			if (slotIndex === 1 && ammo.id !== 'standard' && !ammo.canLoadSecondary) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['ammoIds', slotIndex],
					message: `"${ammoId}" cannot be equipped in secondary ammo slots`
				});
			}
		}

		const seenComponents = new Set<string>();
		for (const [slotIndex, componentId] of selection.componentIds.entries()) {
			if (!componentId) continue;

			if (!catalog.componentById.has(componentId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['componentIds', slotIndex],
					message: `Unknown componentId "${componentId}"`
				});
				continue;
			}

			if (seenComponents.has(componentId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['componentIds', slotIndex],
					message: `Duplicate componentId "${componentId}" is not allowed`
				});
				continue;
			}

			seenComponents.add(componentId);
		}

		const talentNodes = getPlannerTalentsForVehicle(catalog, selection.vehicleId);
		const talentNodeById = new Map(talentNodes.map((node) => [node.talent.id, node]));
		let totalPoints = 0;

		for (const [talentId, points] of Object.entries(selection.talentPoints)) {
			const node = talentNodeById.get(talentId);
			if (!node) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['talentPoints', talentId],
					message: `Unknown talentId "${talentId}" for ${selection.vehicleId}`
				});
				continue;
			}

			if (points > node.maxPoints) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['talentPoints', talentId],
					message: `"${talentId}" cannot exceed ${node.maxPoints} points`
				});
			}

			totalPoints += points;
		}

		if (totalPoints > MAX_TOTAL_TALENT_POINTS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['talentPoints'],
				message: `Total talent points cannot exceed ${MAX_TOTAL_TALENT_POINTS}`
			});
		}

		for (const [talentId, points] of Object.entries(selection.talentPoints)) {
			if (points <= 0) continue;

			const node = talentNodeById.get(talentId);
			if (!node) continue;

			if (!talentPrerequisitesSatisfied(node, selection.talentPoints, talentNodes)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['talentPoints', talentId],
					message: `"${talentId}" does not satisfy its prerequisite talents`
				});
			}

			const pointsSpentBelow = getPointsSpentInTiersBelow(
				talentNodes,
				selection.talentPoints,
				node.tier
			);
			const unlockRequirement = getTalentTierUnlockRequirement(node.tier);
			if (pointsSpentBelow < unlockRequirement) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['talentPoints', talentId],
					message: `"${talentId}" requires ${unlockRequirement} points in lower tiers`
				});
			}
		}
	});

const buildBodyBaseSchema = z
	.object({
		title: z
			.string()
			.trim()
			.max(
				MAX_BUILD_TITLE_LENGTH,
				`title must be ${MAX_BUILD_TITLE_LENGTH} characters or fewer`
			)
			.optional(),
		vehicleId: z.string().min(1, 'vehicleId is required'),
		selection: selectionSchema,
		isPublic: z.boolean().optional()
	})
	.strict();

function refineBuildBody(
	body: Pick<CreateBuildBody, 'vehicleId' | 'selection'>,
	ctx: z.RefinementCtx
) {
		if (!catalog.vehicleById.has(body.vehicleId)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['vehicleId'],
				message: 'Unknown vehicleId'
			});
		}

		if (body.selection.vehicleId !== body.vehicleId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['selection', 'vehicleId'],
				message: 'selection.vehicleId must match vehicleId'
			});
		}
}

export const createBuildBodySchema = buildBodyBaseSchema.superRefine(refineBuildBody);

export const updateBuildBodySchema = buildBodyBaseSchema
	.extend({
		id: z.string().uuid('id must be a valid UUID')
	})
	.superRefine(refineBuildBody);

export const exportBuildBodySchema = buildBodyBaseSchema
	.omit({ isPublic: true })
	.superRefine(refineBuildBody);

export const deleteBuildBodySchema = z
	.object({
		id: z.string().uuid('id must be a valid UUID')
	})
	.strict();

export const toggleBuildStarBodySchema = z
	.object({
		buildId: z.string().uuid('buildId must be a valid UUID')
	})
	.strict();

export type CreateBuildBody = z.infer<typeof createBuildBodySchema>;
export type UpdateBuildBody = z.infer<typeof updateBuildBodySchema>;
export type ExportBuildBody = z.infer<typeof exportBuildBodySchema>;
export type DeleteBuildBody = z.infer<typeof deleteBuildBodySchema>;
export type ToggleBuildStarBody = z.infer<typeof toggleBuildStarBodySchema>;

function formatValidationError(validationError: z.ZodError) {
	const [issue] = validationError.issues;
	if (!issue) return 'Invalid request body';

	const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
	return `${path}${issue.message}`;
}

export function normalizeBuildTitle(title?: string) {
	return title?.trim() ? title.trim() : DEFAULT_BUILD_TITLE;
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		error(400, formatValidationError(parsed.error));
	}

	return parsed.data;
}

export function validateCreateBuildBody(body: unknown) {
	return createBuildBodySchema.safeParse(body);
}

export function validateUpdateBuildBody(body: unknown) {
	return updateBuildBodySchema.safeParse(body);
}

export function validateExportBuildBody(body: unknown) {
	return exportBuildBodySchema.safeParse(body);
}

export function validateDeleteBuildBody(body: unknown) {
	return deleteBuildBodySchema.safeParse(body);
}

export function validateToggleBuildStarBody(body: unknown) {
	return toggleBuildStarBodySchema.safeParse(body);
}

export type ValidPlannerSelection = PlannerSelection;

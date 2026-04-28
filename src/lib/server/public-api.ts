import type {
	AmmoRecord,
	ComponentRecord,
	GameDataBundle,
	MapRecord,
	TalentRecord,
	TalentTreeRecord,
	VehicleRecord
} from '$lib/types/game';

import { getGameDataBundle } from '$lib/data/game-data';

export const PUBLIC_API_VERSION = 'v1';
export const PUBLIC_API_DEFAULT_LIMIT = 50;
export const PUBLIC_API_MAX_LIMIT = 100;
export const PUBLIC_API_RESOURCES = [
	'vehicles',
	'ammo',
	'components',
	'talents',
	'talent-trees',
	'maps'
] as const;

export type PublicApiResourceName = (typeof PUBLIC_API_RESOURCES)[number];

type OpenApiFilterParam = {
	name: string;
	description: string;
	schema: Record<string, unknown>;
};

type PublicApiResourceConfig<T> = {
	singularLabel: string;
	schemaName: string;
	exampleId: string;
	collection: (bundle: GameDataBundle) => T[];
	serialize: (item: T) => Record<string, unknown>;
	filters?: Record<string, (item: T, value: string) => boolean | 'invalid'>;
	filterParams?: OpenApiFilterParam[];
};

type ResourceListSuccess = {
	ok: true;
	data: Record<string, unknown>[];
	pagination: {
		limit: number;
		count: number;
		total: number;
		nextCursor: string | null;
	};
};

type ResourceError = {
	ok: false;
	status: number;
	code: string;
	message: string;
};

type ResourceResult = ResourceListSuccess | ResourceError;

function getBundle() {
	return getGameDataBundle();
}

const exampleIds = (() => {
	const bundle = getBundle();

	return {
		vehicles: bundle.vehicles[0]?.id ?? 'blink',
		ammo: bundle.ammo[0]?.id ?? 'standard',
		components: bundle.components[0]?.id ?? 'adaptivehardening',
		talents: bundle.talents[0]?.id ?? 'healer-talent019',
		talentTrees: bundle.talentTrees[0]?.id ?? 'blink',
		maps: bundle.maps[0]?.id ?? 'divide'
	};
})();

function parseBooleanFilter(value: string) {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return null;
}

function encodeCursor(offset: number) {
	return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string) {
	try {
		const raw = Buffer.from(cursor, 'base64url').toString('utf8');
		const value = Number.parseInt(raw, 10);
		return Number.isFinite(value) && value >= 0 ? value : null;
	} catch {
		return null;
	}
}

function normalizeValue(value: string) {
	return value.trim().toLowerCase();
}

function getPublicImageUrl(folder: string, id: string, extension = 'png') {
	return `/${folder}/${id}.${extension}`;
}

function serializeVehicle(vehicle: VehicleRecord) {
	return {
		id: vehicle.id,
		key: vehicle.key,
		slug: vehicle.slug,
		name: vehicle.name,
		classId: vehicle.classId,
		classLabel: vehicle.classLabel,
		selectable: vehicle.selectable,
		isWorkInProgress: vehicle.isWorkInProgress,
		stats: vehicle.stats,
		loadout: vehicle.loadout,
		nativeComponents: vehicle.nativeComponents,
		assets: {
			imageUrl: getPublicImageUrl('images/vehicles', vehicle.id),
			modelUrl: getPublicImageUrl('models/vehicles', vehicle.id, 'glb'),
			visualModelUrl: getPublicImageUrl('models/vehicles', `${vehicle.id}-visual`, 'glb'),
			armorDataUrl: getPublicImageUrl('models/vehicles', `${vehicle.id}-armor`, 'json')
		}
	};
}

function serializeAmmo(ammo: AmmoRecord) {
	return {
		id: ammo.id,
		key: ammo.key,
		slug: ammo.slug,
		name: ammo.name,
		displayName: ammo.displayName,
		description: ammo.description,
		selectable: ammo.selectable,
		canLoadSecondary: ammo.canLoadSecondary,
		modifiers: ammo.modifiers,
		assets: {
			iconUrl: getPublicImageUrl('images/ammo', ammo.id)
		}
	};
}

function serializeComponent(component: ComponentRecord) {
	return {
		id: component.id,
		key: component.key,
		slug: component.slug,
		name: component.name,
		description: component.description,
		categoryId: component.categoryId,
		category: component.category,
		pointValues: component.pointValues,
		tagIds: component.tagIds,
		eventTags: component.eventTags,
		effectIds: component.effectIds,
		nativeVehicles: component.nativeVehicles,
		assets: {
			iconUrl: getPublicImageUrl('images/components', component.id)
		}
	};
}

function serializeTalent(talent: TalentRecord) {
	return {
		id: talent.id,
		key: talent.key,
		slug: talent.slug,
		name: talent.name,
		description: talent.description,
		supplementalDescription: talent.supplementalDescription,
		type: talent.type,
		maxPoints: talent.maxPoints,
		pointValues: talent.pointValues,
		eventTags: talent.eventTags,
		effectIds: talent.effectIds,
		assets: {
			iconUrl: getPublicImageUrl('images/talents', talent.id)
		}
	};
}

function serializeTalentTree(tree: TalentTreeRecord) {
	return {
		id: tree.id,
		slug: tree.slug,
		name: tree.name,
		vehicleId: tree.vehicleId,
		talentCount: tree.talentCount,
		nodes: tree.nodes
	};
}

function serializeMap(map: MapRecord) {
	return {
		id: map.id,
		slug: map.slug,
		name: map.name,
		displayName: map.displayName,
		status: map.status,
		assets: {
			minimapImageUrl: getPublicImageUrl('images/maps/minimap', map.id),
			lobbyImageUrl: getPublicImageUrl('images/maps/lobby', map.id)
		}
	};
}

const RESOURCE_CONFIGS: Record<PublicApiResourceName, PublicApiResourceConfig<any>> = {
	vehicles: {
		singularLabel: 'Vehicle',
		schemaName: 'Vehicle',
		exampleId: exampleIds.vehicles,
		collection: (bundle) => bundle.vehicles,
		serialize: serializeVehicle,
		filters: {
			classId: (vehicle: VehicleRecord, value: string) =>
				normalizeValue(vehicle.classId) === normalizeValue(value),
			selectable: (vehicle: VehicleRecord, value: string) => {
				const parsed = parseBooleanFilter(value);
				return parsed == null ? 'invalid' : vehicle.selectable === parsed;
			}
		},
		filterParams: [
			{
				name: 'classId',
				description: 'Filter vehicles by class id.',
				schema: { type: 'string', example: 'light' }
			},
			{
				name: 'selectable',
				description: 'Filter vehicles by whether they are selectable in the planner.',
				schema: { type: 'boolean' }
			}
		]
	},
	ammo: {
		singularLabel: 'Ammo',
		schemaName: 'Ammo',
		exampleId: exampleIds.ammo,
		collection: (bundle) => bundle.ammo,
		serialize: serializeAmmo,
		filters: {
			selectable: (ammo: AmmoRecord, value: string) => {
				const parsed = parseBooleanFilter(value);
				return parsed == null ? 'invalid' : ammo.selectable === parsed;
			},
			canLoadSecondary: (ammo: AmmoRecord, value: string) => {
				const parsed = parseBooleanFilter(value);
				return parsed == null ? 'invalid' : ammo.canLoadSecondary === parsed;
			}
		},
		filterParams: [
			{
				name: 'selectable',
				description: 'Filter ammunition by whether it can be equipped.',
				schema: { type: 'boolean' }
			},
			{
				name: 'canLoadSecondary',
				description: 'Filter ammunition by whether it can be loaded into secondary slots.',
				schema: { type: 'boolean' }
			}
		]
	},
	components: {
		singularLabel: 'Component',
		schemaName: 'Component',
		exampleId: exampleIds.components,
		collection: (bundle) => bundle.components,
		serialize: serializeComponent,
		filters: {
			categoryId: (component: ComponentRecord, value: string) =>
				normalizeValue(component.categoryId) === normalizeValue(value)
		},
		filterParams: [
			{
				name: 'categoryId',
				description: 'Filter components by category id.',
				schema: { type: 'string', example: 'category-durability' }
			}
		]
	},
	talents: {
		singularLabel: 'Talent',
		schemaName: 'Talent',
		exampleId: exampleIds.talents,
		collection: (bundle) => bundle.talents,
		serialize: serializeTalent,
		filters: {
			type: (talent: TalentRecord, value: string) =>
				normalizeValue(talent.type) === normalizeValue(value)
		},
		filterParams: [
			{
				name: 'type',
				description: 'Filter talents by talent type.',
				schema: { type: 'string', example: 'Event' }
			}
		]
	},
	'talent-trees': {
		singularLabel: 'Talent Tree',
		schemaName: 'TalentTree',
		exampleId: exampleIds.talentTrees,
		collection: (bundle) => bundle.talentTrees,
		serialize: serializeTalentTree,
		filters: {
			vehicleId: (tree: TalentTreeRecord, value: string) =>
				normalizeValue(tree.vehicleId) === normalizeValue(value)
		},
		filterParams: [
			{
				name: 'vehicleId',
				description: 'Filter talent trees by owning vehicle id.',
				schema: { type: 'string', example: 'blink' }
			}
		]
	},
	maps: {
		singularLabel: 'Map',
		schemaName: 'Map',
		exampleId: exampleIds.maps,
		collection: (bundle) => bundle.maps,
		serialize: serializeMap,
		filters: {
			status: (map: MapRecord, value: string) =>
				normalizeValue(map.status) === normalizeValue(value)
		},
		filterParams: [
			{
				name: 'status',
				description: 'Filter maps by release status.',
				schema: {
					type: 'string',
					enum: ['released', 'prototype', 'testmap']
				}
			}
		]
	}
};

export function isPublicApiResourceName(value: string): value is PublicApiResourceName {
	return PUBLIC_API_RESOURCES.includes(value as PublicApiResourceName);
}

export function getPublicApiDatasetMeta() {
	const bundle = getBundle();

	return {
		apiVersion: PUBLIC_API_VERSION,
		schemaVersion: bundle.metadata.schemaVersion,
		generatedAt: bundle.metadata.generatedAt,
		rawSource: bundle.metadata.rawSource,
		datasetRevision: `schema-${bundle.metadata.schemaVersion}-${bundle.metadata.generatedAt}`,
		resourceCounts: {
			vehicles: bundle.vehicles.length,
			ammo: bundle.ammo.length,
			components: bundle.components.length,
			talents: bundle.talents.length,
			talentTrees: bundle.talentTrees.length,
			maps: bundle.maps.length
		}
	};
}

export function getPublicApiLastModified() {
	return getBundle().metadata.generatedAt;
}

export function listPublicApiResource(resource: PublicApiResourceName, url: URL): ResourceResult {
	const config = RESOURCE_CONFIGS[resource];
	const limitParam = url.searchParams.get('limit');
	const cursorParam = url.searchParams.get('cursor');

	let limit = PUBLIC_API_DEFAULT_LIMIT;
	if (limitParam) {
		const parsedLimit = Number.parseInt(limitParam, 10);
		if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
			return {
				ok: false,
				status: 400,
				code: 'invalid_limit',
				message: 'Query parameter "limit" must be a positive integer.'
			};
		}
		limit = Math.min(parsedLimit, PUBLIC_API_MAX_LIMIT);
	}

	let offset = 0;
	if (cursorParam) {
		const decoded = decodeCursor(cursorParam);
		if (decoded == null) {
			return {
				ok: false,
				status: 400,
				code: 'invalid_cursor',
				message: 'Query parameter "cursor" is invalid.'
			};
		}
		offset = decoded;
	}

	const allItems = config.collection(getBundle());
	let filteredItems = [...allItems];
	for (const [paramName, matcher] of Object.entries(config.filters ?? {})) {
		const rawValue = url.searchParams.get(paramName);
		if (!rawValue) continue;

		if (allItems[0] && matcher(allItems[0], rawValue) === 'invalid') {
			return {
				ok: false,
				status: 400,
				code: `invalid_${paramName}`,
				message: `Query parameter "${paramName}" is invalid.`
			};
		}

		filteredItems = filteredItems.filter((item) => matcher(item, rawValue) === true);
	}

	const pageItems = filteredItems.slice(offset, offset + limit).map((item) => config.serialize(item));
	const nextOffset = offset + limit;

	return {
		ok: true,
		data: pageItems,
		pagination: {
			limit,
			count: pageItems.length,
			total: filteredItems.length,
			nextCursor: nextOffset < filteredItems.length ? encodeCursor(nextOffset) : null
		}
	};
}

export function getPublicApiResourceById(resource: PublicApiResourceName, id: string) {
	const config = RESOURCE_CONFIGS[resource];
	const match = config.collection(getBundle()).find((item: { id: string }) => item.id === id);

	return match ? config.serialize(match) : null;
}

function buildCollectionSchemaRef(schemaName: string) {
	return {
		type: 'object',
		required: ['data', 'pagination'],
		properties: {
			data: {
				type: 'array',
				items: {
					$ref: `#/components/schemas/${schemaName}`
				}
			},
			pagination: {
				$ref: '#/components/schemas/Pagination'
			}
		}
	};
}

function buildSingleSchemaRef(schemaName: string) {
	return {
		type: 'object',
		required: ['data'],
		properties: {
			data: {
				$ref: `#/components/schemas/${schemaName}`
			}
		}
	};
}

function getOpenApiSchemas() {
	return {
		Error: {
			type: 'object',
			required: ['error'],
			properties: {
				error: {
					type: 'object',
					required: ['code', 'message'],
					properties: {
						code: { type: 'string' },
						message: { type: 'string' }
					}
				}
			}
		},
		Pagination: {
			type: 'object',
			required: ['limit', 'count', 'total', 'nextCursor'],
			properties: {
				limit: { type: 'integer' },
				count: { type: 'integer' },
				total: { type: 'integer' },
				nextCursor: { type: ['string', 'null'] }
			}
		},
		ApiMeta: {
			type: 'object',
			required: ['apiVersion', 'schemaVersion', 'generatedAt', 'datasetRevision', 'resourceCounts'],
			properties: {
				apiVersion: { type: 'string', example: PUBLIC_API_VERSION },
				schemaVersion: { type: 'integer' },
				generatedAt: { type: 'string', format: 'date-time' },
				rawSource: { type: 'string' },
				datasetRevision: { type: 'string' },
				resourceCounts: {
					type: 'object',
					additionalProperties: { type: 'integer' }
				}
			}
		},
		Vehicle: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				key: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				classId: { type: 'string' },
				classLabel: { type: 'string' },
				selectable: { type: 'boolean' },
				isWorkInProgress: { type: 'boolean' },
				stats: { type: 'object', additionalProperties: { type: 'number' } },
				loadout: { type: 'object', additionalProperties: true },
				nativeComponents: { type: 'array', items: { type: 'object', additionalProperties: true } },
				assets: { type: 'object', additionalProperties: { type: 'string' } }
			},
			required: ['id', 'key', 'slug', 'name', 'classId', 'classLabel', 'selectable', 'isWorkInProgress', 'stats', 'loadout', 'nativeComponents', 'assets']
		},
		Ammo: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				key: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				displayName: { type: 'string' },
				description: { type: 'string' },
				selectable: { type: 'boolean' },
				canLoadSecondary: { type: 'boolean' },
				modifiers: { type: 'object', additionalProperties: { type: 'number' } },
				assets: { type: 'object', additionalProperties: { type: 'string' } }
			},
			required: ['id', 'key', 'slug', 'name', 'displayName', 'description', 'selectable', 'canLoadSecondary', 'modifiers', 'assets']
		},
		Component: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				key: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				description: { type: 'string' },
				categoryId: { type: 'string' },
				category: { type: 'string' },
				pointValues: { type: 'array', items: { type: 'number' } },
				tagIds: { type: 'array', items: { type: 'string' } },
				eventTags: { type: 'array', items: { type: 'string' } },
				effectIds: { type: 'array', items: { type: 'string' } },
				nativeVehicles: { type: 'array', items: { type: 'object', additionalProperties: true } },
				assets: { type: 'object', additionalProperties: { type: 'string' } }
			},
			required: ['id', 'key', 'slug', 'name', 'description', 'categoryId', 'category', 'pointValues', 'tagIds', 'eventTags', 'effectIds', 'nativeVehicles', 'assets']
		},
		Talent: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				key: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				description: { type: 'string' },
				supplementalDescription: { type: 'string' },
				type: { type: 'string' },
				maxPoints: { type: 'integer' },
				pointValues: { type: 'array', items: { type: 'number' } },
				eventTags: { type: 'array', items: { type: 'string' } },
				effectIds: { type: 'array', items: { type: 'string' } },
				assets: { type: 'object', additionalProperties: { type: 'string' } }
			},
			required: ['id', 'key', 'slug', 'name', 'description', 'supplementalDescription', 'type', 'maxPoints', 'pointValues', 'eventTags', 'effectIds', 'assets']
		},
		TalentTree: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				vehicleId: { type: 'string' },
				talentCount: { type: 'integer' },
				nodes: { type: 'array', items: { type: 'object', additionalProperties: true } }
			},
			required: ['id', 'slug', 'name', 'vehicleId', 'talentCount', 'nodes']
		},
		Map: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				slug: { type: 'string' },
				name: { type: 'string' },
				displayName: { type: 'string' },
				status: { type: 'string', enum: ['released', 'prototype', 'testmap'] },
				assets: { type: 'object', additionalProperties: { type: 'string' } }
			},
			required: ['id', 'slug', 'name', 'displayName', 'status', 'assets']
		},
		ApiMetaResponse: buildSingleSchemaRef('ApiMeta'),
		VehicleCollectionResponse: buildCollectionSchemaRef('Vehicle'),
		VehicleResponse: buildSingleSchemaRef('Vehicle'),
		AmmoCollectionResponse: buildCollectionSchemaRef('Ammo'),
		AmmoResponse: buildSingleSchemaRef('Ammo'),
		ComponentCollectionResponse: buildCollectionSchemaRef('Component'),
		ComponentResponse: buildSingleSchemaRef('Component'),
		TalentCollectionResponse: buildCollectionSchemaRef('Talent'),
		TalentResponse: buildSingleSchemaRef('Talent'),
		TalentTreeCollectionResponse: buildCollectionSchemaRef('TalentTree'),
		TalentTreeResponse: buildSingleSchemaRef('TalentTree'),
		MapCollectionResponse: buildCollectionSchemaRef('Map'),
		MapResponse: buildSingleSchemaRef('Map')
	};
}

function getCollectionParameters(resource: PublicApiResourceName) {
	const config = RESOURCE_CONFIGS[resource];

	return [
		{
			name: 'limit',
			in: 'query',
			description: `Maximum number of ${resource} to return. Defaults to ${PUBLIC_API_DEFAULT_LIMIT}; max ${PUBLIC_API_MAX_LIMIT}.`,
			schema: {
				type: 'integer',
				default: PUBLIC_API_DEFAULT_LIMIT,
				maximum: PUBLIC_API_MAX_LIMIT,
				minimum: 1
			}
		},
		{
			name: 'cursor',
			in: 'query',
			description: 'Opaque pagination cursor returned by a previous collection response.',
			schema: { type: 'string' }
		},
		...(config.filterParams ?? []).map((param) => ({
			name: param.name,
			in: 'query',
			description: param.description,
			schema: param.schema
		}))
	];
}

export function createOpenApiDocument() {
	const meta = getPublicApiDatasetMeta();
	const paths: Record<string, unknown> = {
		'/api/v1/meta': {
			get: {
				summary: 'Get API and dataset metadata',
				operationId: 'getApiMeta',
				tags: ['Meta'],
				security: [{ BearerAuth: [] }],
				responses: {
					'200': {
						description: 'API metadata response.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ApiMetaResponse' }
							}
						}
					},
					'401': {
						description: 'Missing or invalid API key.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					},
					'429': {
						description: 'Rate limit exceeded.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					}
				}
			}
		}
	};

	for (const resource of PUBLIC_API_RESOURCES) {
		const config = RESOURCE_CONFIGS[resource];

		paths[`/api/v1/${resource}`] = {
			get: {
				summary: `List ${resource}`,
				operationId: `list${config.schemaName}`,
				tags: [config.singularLabel],
				security: [{ BearerAuth: [] }],
				parameters: getCollectionParameters(resource),
				responses: {
					'200': {
						description: `${config.singularLabel} collection response.`,
						content: {
							'application/json': {
								schema: { $ref: `#/components/schemas/${config.schemaName}CollectionResponse` }
							}
						}
					},
					'400': {
						description: 'Invalid query parameters.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					},
					'401': {
						description: 'Missing or invalid API key.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					},
					'429': {
						description: 'Rate limit exceeded.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					}
				}
			}
		};

		paths[`/api/v1/${resource}/{id}`] = {
			get: {
				summary: `Get a ${config.singularLabel.toLowerCase()} by id`,
				operationId: `get${config.schemaName}`,
				tags: [config.singularLabel],
				security: [{ BearerAuth: [] }],
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						description: `${config.singularLabel} id.`,
						schema: { type: 'string', example: config.exampleId }
					}
				],
				responses: {
					'200': {
						description: `${config.singularLabel} detail response.`,
						content: {
							'application/json': {
								schema: { $ref: `#/components/schemas/${config.schemaName}Response` }
							}
						}
					},
					'401': {
						description: 'Missing or invalid API key.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					},
					'404': {
						description: `${config.singularLabel} not found.`,
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					},
					'429': {
						description: 'Rate limit exceeded.',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
					}
				}
			}
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'Tyr HQ Public API',
			version: PUBLIC_API_VERSION,
			description:
				'Public read-only game data API for Tyr HQ. View this document publicly, then generate an API key from /settings/api to make requests.'
		},
		servers: [{ url: '/' }],
		tags: [
			{ name: 'Meta', description: 'API and dataset metadata.' },
			...PUBLIC_API_RESOURCES.map((resource) => ({
				name: RESOURCE_CONFIGS[resource].singularLabel,
				description: `${RESOURCE_CONFIGS[resource].singularLabel} resources.`
			}))
		],
		security: [{ BearerAuth: [] }],
		paths,
		components: {
			securitySchemes: {
				BearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'API Key',
					description: 'Paste the full Tyr HQ API key issued from the Developer API settings page.'
				}
			},
			schemas: getOpenApiSchemas()
		},
		'x-dataset-revision': meta.datasetRevision
	};
}

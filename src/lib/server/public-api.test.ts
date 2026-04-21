import { describe, expect, it } from 'vitest';

import {
	createOpenApiDocument,
	getPublicApiDatasetMeta,
	getPublicApiResourceById,
	getPublicApiLastModified,
	isPublicApiResourceName,
	listPublicApiResource
} from './public-api';

describe('isPublicApiResourceName', () => {
	it('accepts configured resources', () => {
		expect(isPublicApiResourceName('vehicles')).toBe(true);
		expect(isPublicApiResourceName('unknown')).toBe(false);
	});
});

describe('listPublicApiResource', () => {
	it('supports filtered pagination for vehicles', () => {
		const result = listPublicApiResource(
			'vehicles',
			new URL('https://tyr-hq.test/api/v1/vehicles?classId=light&limit=1')
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.data).toHaveLength(1);
		expect(result.pagination.limit).toBe(1);
		expect(
			typeof result.pagination.nextCursor === 'string' || result.pagination.nextCursor === null
		).toBe(true);
	});

	it('rejects invalid cursors', () => {
		const result = listPublicApiResource(
			'vehicles',
			new URL('https://tyr-hq.test/api/v1/vehicles?cursor=not-valid')
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(400);
	});
});

describe('getPublicApiResourceById', () => {
	it('returns a canonical map record by id', () => {
		const maps = listPublicApiResource('maps', new URL('https://tyr-hq.test/api/v1/maps?limit=1'));
		expect(maps.ok).toBe(true);
		if (!maps.ok) return;

		const mapId = String(maps.data[0]?.id ?? '');
		expect(mapId).not.toBe('');

		const result = getPublicApiResourceById('maps', mapId);
		expect(result).not.toBeNull();
		expect(result?.id).toBe(mapId);
	});
});

describe('createOpenApiDocument', () => {
	it('publishes a bearer-auth protected spec', () => {
		const document = createOpenApiDocument();

		expect(document.openapi).toBe('3.1.0');
		expect(document.paths['/api/v1/vehicles']).toBeDefined();
		expect(document.components.securitySchemes.BearerAuth).toBeDefined();
	});
});

describe('getPublicApiDatasetMeta', () => {
	it('includes a dataset revision and resource counts', () => {
		const meta = getPublicApiDatasetMeta();

		expect(meta.apiVersion).toBe('v1');
		expect(meta.datasetRevision).toContain('schema-');
		expect(meta.resourceCounts.vehicles).toBeGreaterThan(0);
	});

	it('reuses the generated timestamp as its last-modified value', () => {
		expect(getPublicApiLastModified()).toBe(getPublicApiDatasetMeta().generatedAt);
	});
});

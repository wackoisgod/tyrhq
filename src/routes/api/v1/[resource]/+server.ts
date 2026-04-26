import type { RequestHandler } from './$types';

import { withPublicApiAuth } from '$lib/server/public-api-auth';
import {
	getPublicApiDatasetMeta,
	getPublicApiLastModified,
	isPublicApiResourceName,
	listPublicApiResource
} from '$lib/server/public-api';
import {
	createPublicApiEtag,
	createPublicApiErrorResponse,
	createPublicApiJsonResponse,
	createPublicApiNotModifiedResponse,
	requestMatchesEtag
} from '$lib/server/public-api-http';

export const GET: RequestHandler = async (event) =>
	withPublicApiAuth(event, async () => {
		const resource = event.params.resource;
		if (!isPublicApiResourceName(resource)) {
			return createPublicApiErrorResponse(404, 'resource_not_found', 'Unknown API resource.');
		}

		const result = listPublicApiResource(resource, event.url);
		if (!result.ok) {
			return createPublicApiErrorResponse(result.status, result.code, result.message);
		}

		const etag = createPublicApiEtag(
			`${getPublicApiDatasetMeta().datasetRevision}:${event.url.pathname}${event.url.search}`
		);
		const lastModified = getPublicApiLastModified();

		if (requestMatchesEtag(event.request, etag)) {
			return createPublicApiNotModifiedResponse({ etag, lastModified });
		}

		return createPublicApiJsonResponse(
			{
				data: result.data,
				pagination: result.pagination
			},
			{ etag, lastModified }
		);
	});

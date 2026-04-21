import type { RequestHandler } from './$types';

import { withPublicApiAuth } from '$lib/server/public-api-auth';
import {
	getPublicApiDatasetMeta,
	getPublicApiLastModified,
	getPublicApiResourceById,
	isPublicApiResourceName
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

		const data = getPublicApiResourceById(resource, event.params.id);
		if (!data) {
			return createPublicApiErrorResponse(
				404,
				'resource_not_found',
				`No resource exists with id "${event.params.id}".`
			);
		}

		const etag = createPublicApiEtag(
			`${getPublicApiDatasetMeta().datasetRevision}:${event.url.pathname}`
		);
		const lastModified = getPublicApiLastModified();

		if (requestMatchesEtag(event.request, etag)) {
			return createPublicApiNotModifiedResponse({ etag, lastModified });
		}

		return createPublicApiJsonResponse({ data }, { etag, lastModified });
	});

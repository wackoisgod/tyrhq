import type { RequestHandler } from './$types';

import { createOpenApiDocument, getPublicApiDatasetMeta, getPublicApiLastModified } from '$lib/server/public-api';
import {
	createPublicApiEtag,
	createPublicApiJsonResponse,
	createPublicApiNotModifiedResponse,
	requestMatchesEtag
} from '$lib/server/public-api-http';

export const GET: RequestHandler = async ({ request, url }) => {
	const document = createOpenApiDocument();
	const etag = createPublicApiEtag(
		`${getPublicApiDatasetMeta().datasetRevision}:${url.pathname}`
	);
	const lastModified = getPublicApiLastModified();

	if (requestMatchesEtag(request, etag)) {
		return createPublicApiNotModifiedResponse({
			etag,
			lastModified,
			cacheControl: 'public, max-age=300'
		});
	}

	return createPublicApiJsonResponse(document, {
		etag,
		lastModified,
		cacheControl: 'public, max-age=300'
	});
};

import type { RequestHandler } from './$types';

import { withPublicApiAuth } from '$lib/server/public-api-auth';
import { getPublicApiDatasetMeta, getPublicApiLastModified } from '$lib/server/public-api';
import {
	createPublicApiEtag,
	createPublicApiJsonResponse,
	createPublicApiNotModifiedResponse,
	requestMatchesEtag
} from '$lib/server/public-api-http';

export const GET: RequestHandler = async (event) =>
	withPublicApiAuth(event, async () => {
		const data = getPublicApiDatasetMeta();
		const etag = createPublicApiEtag(`${data.datasetRevision}:${event.url.pathname}`);
		const lastModified = getPublicApiLastModified();

		if (requestMatchesEtag(event.request, etag)) {
			return createPublicApiNotModifiedResponse({ etag, lastModified });
		}

		return createPublicApiJsonResponse({ data }, { etag, lastModified });
	});

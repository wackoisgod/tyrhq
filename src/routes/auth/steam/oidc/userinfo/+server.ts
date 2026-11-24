/**
 * OIDC UserInfo Endpoint
 * GET /auth/steam/oidc/userinfo
 * 
 * Returns user claims from access token
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	
	if (!authHeader?.startsWith('Bearer ')) {
		throw error(401, 'Missing or invalid authorization header');
	}

	const accessToken = authHeader.slice(7);
	const result = await steamOidcProvider.userinfo(accessToken, url.origin);

	if ('error' in result) {
		return json(result, { status: 401 });
	}

	return json(result);
};

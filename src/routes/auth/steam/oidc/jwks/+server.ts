/**
 * JWKS Endpoint
 * GET /auth/steam/oidc/jwks
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

export const GET: RequestHandler = async () => {
	const jwks = await steamOidcProvider.getJWKS();
	
	return json(jwks, {
		headers: {
			'Cache-Control': 'public, max-age=3600'
		}
	});
};

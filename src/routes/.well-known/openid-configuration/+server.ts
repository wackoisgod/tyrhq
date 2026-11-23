/**
 * OpenID Connect Discovery Document
 * GET /.well-known/openid-configuration
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

export const GET: RequestHandler = async ({ url }) => {
	const discovery = await steamOidcProvider.getDiscoveryDocument(url.origin);
	
	return json(discovery, {
		headers: {
			'Cache-Control': 'public, max-age=3600'
		}
	});
};

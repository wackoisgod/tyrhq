/**
 * Steam OpenID Callback for OIDC Bridge
 * GET /auth/steam/oidc/callback
 * 
 * Handles Steam's return, verifies signature, generates authorization code
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

export const GET: RequestHandler = async ({ url }) => {
	const result = await steamOidcProvider.handleSteamCallback(url.searchParams, url.origin);

	if ('error' in result) {
		throw error(400, result.error);
	}

	throw redirect(303, result.redirectUrl);
};

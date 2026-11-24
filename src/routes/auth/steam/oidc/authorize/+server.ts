/**
 * OIDC Authorization Endpoint
 * GET /auth/steam/oidc/authorize
 * 
 * Initiates Steam OpenID authentication flow
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

export const GET: RequestHandler = async ({ url }) => {
	const params = {
		client_id: url.searchParams.get('client_id') || '',
		redirect_uri: url.searchParams.get('redirect_uri') || '',
		response_type: url.searchParams.get('response_type') || '',
		scope: url.searchParams.get('scope') || '',
		state: url.searchParams.get('state') || '',
		code_challenge: url.searchParams.get('code_challenge') || undefined,
		code_challenge_method: url.searchParams.get('code_challenge_method') || undefined
	};

	const result = await steamOidcProvider.authorize(params, url.origin);

	if ('error' in result) {
		throw error(400, result.error);
	}

	throw redirect(303, result.redirectUrl);
};

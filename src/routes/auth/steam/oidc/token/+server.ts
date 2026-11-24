/**
 * OIDC Token Endpoint
 * POST /auth/steam/oidc/token
 * 
 * Exchanges authorization code for access token and ID token
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { steamOidcProvider } from '$lib/server/steam-oidc-provider';

/**
 * RFC 6749 §2.3.1: HTTP Basic credentials are form-urlencoded, then base64.
 * Split on the first colon only so a secret may contain colons, then
 * decode each part (application/x-www-form-urlencoded: '+' is a space).
 */
export function decodeBasicClientCredentials(
	authHeader: string
): { clientId: string; clientSecret: string } | null {
	if (!authHeader.startsWith('Basic ')) return null;

	const decoded = Buffer.from(authHeader.slice('Basic '.length).trim(), 'base64').toString('utf8');
	const separator = decoded.indexOf(':');
	if (separator < 0) return null;

	const decodePart = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
	try {
		return {
			clientId: decodePart(decoded.slice(0, separator)),
			clientSecret: decodePart(decoded.slice(separator + 1))
		};
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request, url }) => {
	const contentType = request.headers.get('content-type');
	let params: any;

	if (contentType?.includes('application/x-www-form-urlencoded')) {
		const formData = await request.formData();
		params = {
			grant_type: formData.get('grant_type') || '',
			code: formData.get('code') || '',
			redirect_uri: formData.get('redirect_uri') || '',
			code_verifier: formData.get('code_verifier') || '',
			client_id: formData.get('client_id') || '',
			client_secret: formData.get('client_secret') || ''
		};
	} else if (contentType?.includes('application/json')) {
		params = await request.json();
	} else {
		throw error(400, 'Invalid content type');
	}

	// Also support Basic Auth for client credentials (Go tries this first)
	const authHeader = request.headers.get('authorization');
	if (authHeader?.startsWith('Basic ')) {
		const credentials = decodeBasicClientCredentials(authHeader);
		if (credentials) {
			params.client_id = params.client_id || credentials.clientId;
			params.client_secret = params.client_secret || credentials.clientSecret;
		}
	}

	const result = await steamOidcProvider.token(params, url.origin);

	if ('error' in result) {
		return json(result, { status: 400 });
	}

	return json(result);
};

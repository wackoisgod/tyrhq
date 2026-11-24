/**
 * Authorization-code round trip and RFC 6749 client_secret_basic decoding.
 * A private CryptoKey cannot verify RS256, and a urlencoded secret that
 * contains a colon must survive Basic auth.
 */

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const CLIENT_ID = 'steam client';
const CLIENT_SECRET = 's3cret:with+plus/slash and@at';
const ORIGIN = 'https://www.tyrhq.com';
const REDIRECT_URI = `${ORIGIN}/auth/v1/callback`;
const STEAM_ID = '76561198000000001';

const { testEnv } = vi.hoisted(() => ({
	testEnv: {
		STEAM_OIDC_PRIVATE_KEY: '',
		STEAM_OIDC_CLIENT_ID: 'steam client',
		STEAM_OIDC_CLIENT_SECRET: 's3cret:with+plus/slash and@at',
		STEAM_OIDC_ISSUER: 'https://www.tyrhq.com'
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: testEnv
}));

const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	publicKeyEncoding: { type: 'spki', format: 'pem' }
});
testEnv.STEAM_OIDC_PRIVATE_KEY = privateKey;

const { generateStatelessCode, verifyStatelessCode, steamOidcProvider } = await import(
	'$lib/server/steam-oidc-provider'
);
const { decodeBasicClientCredentials } = await import('$lib/server/basic-client-auth');
const { POST } = await import('../../routes/auth/steam/oidc/token/+server');

/** application/x-www-form-urlencoded, matching Go's url.QueryEscape before Basic auth. */
function formUrlEncode(value: string): string {
	return encodeURIComponent(value).replace(/%20/g, '+');
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
	const token = Buffer.from(`${formUrlEncode(clientId)}:${formUrlEncode(clientSecret)}`).toString(
		'base64'
	);
	return `Basic ${token}`;
}

describe('Steam OIDC authorization codes', () => {
	it('verifies a code it just signed', async () => {
		const code = await generateStatelessCode({
			steamId: STEAM_ID,
			redirectUri: REDIRECT_URI,
			clientId: CLIENT_ID
		});

		const verified = await verifyStatelessCode(code, ORIGIN);

		expect(verified).toMatchObject({
			steamId: STEAM_ID,
			redirectUri: REDIRECT_URI,
			clientId: CLIENT_ID
		});
		expect(verified?.jti).toEqual(expect.any(String));
		expect(await verifyStatelessCode('not-a-code', ORIGIN)).toBeNull();
	});

	it('exchanges a valid code for tokens', async () => {
		const code = await generateStatelessCode({
			steamId: STEAM_ID,
			redirectUri: REDIRECT_URI,
			clientId: CLIENT_ID
		});

		const result = await steamOidcProvider.token(
			{
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT_URI,
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET
			},
			ORIGIN
		);

		expect(result).toMatchObject({
			token_type: 'Bearer',
			expires_in: 3600
		});
		if (!('access_token' in result)) {
			throw new Error(`token exchange failed: ${JSON.stringify(result)}`);
		}
		expect(result.access_token.split('.')).toHaveLength(3);
		expect(result.id_token.split('.')).toHaveLength(3);

		const profile = await steamOidcProvider.userinfo(result.access_token, ORIGIN);
		expect(profile).toMatchObject({
			sub: `steam:${STEAM_ID}`,
			steam_id: STEAM_ID
		});
	});
});

describe('Steam OIDC Basic client authentication', () => {
	it('accepts a urlencoded secret that contains special characters and a colon', async () => {
		const header = basicAuthHeader(CLIENT_ID, CLIENT_SECRET);
		expect(decodeBasicClientCredentials(header)).toEqual({
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET
		});

		const code = await generateStatelessCode({
			steamId: STEAM_ID,
			redirectUri: REDIRECT_URI,
			clientId: CLIENT_ID
		});
		const request = new Request(`${ORIGIN}/auth/steam/oidc/token`, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				authorization: header
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT_URI
			})
		});

		const response = await POST({
			request,
			url: new URL(request.url)
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.token_type).toBe('Bearer');
		expect(body.access_token.split('.')).toHaveLength(3);
		expect(body.id_token.split('.')).toHaveLength(3);
	});
});

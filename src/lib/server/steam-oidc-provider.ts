/**
 * Steam OIDC Provider - Internal Bridge
 *
 * Wraps Steam OpenID 2.0 as an OpenID Connect (OIDC) provider so it can be
 * registered as a custom provider in Supabase Dashboard > Auth > Custom Providers.
 *
 * Steam only supports OpenID 2.0, but Supabase requires OIDC. This bridge:
 * - Exposes OIDC discovery endpoint (/.well-known/openid-configuration)
 * - Implements OIDC authorize → Steam OpenID redirect + verification
 * - Implements OIDC token endpoint (authorization_code flow)
 * - Implements OIDC userinfo endpoint
 * - Exposes JWKS for RS256 signature verification
 *
 * Security:
 * - PKCE required (code_challenge/code_verifier)
 * - State parameter required
 * - Short-lived authorization codes (5 minutes)
 * - RS256 signed tokens
 * - Strict redirect_uri allowlist
 * - Server-side Steam assertion verification (never trust query params alone)
 */

import { env } from '$env/dynamic/private';
import { createRemoteJWKSet, SignJWT, jwtVerify, importPKCS8, exportJWK } from 'jose';
import type { JWK } from 'jose';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
const STEAM_API_TIMEOUT_MS = 3000;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_SECONDS = 3600; // 1 hour

interface PendingAuthCode {
	code: string;
	steamId: string;
	redirectUri: string;
	codeChallenge: string;
	createdAt: number;
}

// In-memory store for pending codes (production should use Redis or similar)
const pendingCodes = new Map<string, PendingAuthCode>();

/**
 * Get or generate RSA keys for JWT signing
 * In production with multiple instances, use a shared key store
 */
let cachedPrivateKey: CryptoKey | null = null;
let cachedPublicJWK: JWK | null = null;

async function getOrGenerateKeys(): Promise<{ privateKey: CryptoKey; publicJWK: JWK }> {
	if (cachedPrivateKey && cachedPublicJWK) {
		return { privateKey: cachedPrivateKey, publicJWK: cachedPublicJWK };
	}

	const privateKeyPem = env.STEAM_OIDC_PRIVATE_KEY;
	if (!privateKeyPem) {
		throw new Error('STEAM_OIDC_PRIVATE_KEY not configured');
	}

	// Import private key from PEM
	const privateKey = await importPKCS8(privateKeyPem, 'RS256');
	
	// Export public key as JWK
	const publicJWK = await exportJWK(privateKey);
	
	// Add key ID and algorithm
	publicJWK.kid = 'steam-oidc-1';
	publicJWK.alg = 'RS256';
	publicJWK.use = 'sig';
	
	cachedPrivateKey = privateKey;
	cachedPublicJWK = publicJWK;
	
	return { privateKey, publicJWK };
}

/**
 * Generate a random code
 */
function generateCode(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash code_verifier to compare with code_challenge (SHA-256 base64url)
 */
async function hashCodeVerifier(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest('SHA-256', data);
	
	// Base64url encode
	const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Verify Steam OpenID signature
 */
async function verifyOpenIdSignature(params: URLSearchParams): Promise<boolean> {
	const verifyParams = new URLSearchParams(params);
	verifyParams.set('openid.mode', 'check_authentication');

	try {
		const response = await fetch(STEAM_OPENID_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: verifyParams.toString()
		});

		if (!response.ok) return false;

		const text = await response.text();
		return text.split('\n').some(line => line.trim() === 'is_valid:true');
	} catch {
		return false;
	}
}

/**
 * Extract SteamID64 from claimed_id
 */
function extractSteamId(claimedId: string): string | null {
	const match = claimedId.match(STEAM_ID_REGEX);
	return match ? match[1] : null;
}

/**
 * Fetch Steam persona info from Web API
 */
async function fetchSteamPersona(steamId: string): Promise<{ personaname: string; avatarfull: string } | null> {
	const apiKey = env.STEAM_WEB_API_KEY;
	if (!apiKey) {
		console.warn('[steam-oidc] STEAM_WEB_API_KEY not set - cannot fetch persona');
		return null;
	}

	try {
		const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(STEAM_API_TIMEOUT_MS) });
		
		if (!response.ok) return null;
		
		const data = await response.json();
		const player = data.response?.players?.[0];
		
		if (!player) return null;
		
		return {
			personaname: player.personaname || `Player_${steamId.slice(-6)}`,
			avatarfull: player.avatarfull || ''
		};
	} catch {
		return null;
	}
}

/**
 * Check if redirect_uri is allowed
 */
function isRedirectUriAllowed(redirectUri: string, origin: string): boolean {
	const allowedList = env.STEAM_OIDC_REDIRECT_ALLOWLIST?.split(',').map(s => s.trim()) || [];
	
	// Always allow Supabase callback endpoints on same origin
	const defaultAllowed = [
		`${origin}/auth/v1/callback`,
		`${origin}/auth/callback`
	];
	
	const allowed = [...defaultAllowed, ...allowedList];
	
	return allowed.some(pattern => {
		if (pattern.includes('*')) {
			// Simple wildcard matching
			const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
			return regex.test(redirectUri);
		}
		return redirectUri === pattern;
	});
}

/**
 * Get issuer URL (this application's public URL)
 */
function getIssuer(origin: string): string {
	return env.STEAM_OIDC_ISSUER || origin;
}

/**
 * Get client ID for Supabase
 */
function getClientId(): string {
	const clientId = env.STEAM_OIDC_CLIENT_ID;
	if (!clientId) {
		throw new Error('STEAM_OIDC_CLIENT_ID not configured');
	}
	return clientId;
}

/**
 * Verify client_secret
 */
function verifyClientSecret(secret: string | null): boolean {
	const expectedSecret = env.STEAM_OIDC_CLIENT_SECRET;
	if (!expectedSecret) {
		throw new Error('STEAM_OIDC_CLIENT_SECRET not configured');
	}
	return secret === expectedSecret;
}

/**
 * Clean up expired codes periodically
 */
function cleanupExpiredCodes() {
	const now = Date.now();
	for (const [code, data] of pendingCodes.entries()) {
		if (now - data.createdAt > CODE_TTL_MS) {
			pendingCodes.delete(code);
		}
	}
}

// Run cleanup every minute
setInterval(cleanupExpiredCodes, 60_000);

export const steamOidcProvider = {
	/**
	 * OpenID Connect Discovery Document
	 */
	async getDiscoveryDocument(origin: string) {
		const issuer = getIssuer(origin);
		return {
			issuer,
			authorization_endpoint: `${issuer}/auth/steam/oidc/authorize`,
			token_endpoint: `${issuer}/auth/steam/oidc/token`,
			userinfo_endpoint: `${issuer}/auth/steam/oidc/userinfo`,
			jwks_uri: `${issuer}/auth/steam/oidc/jwks`,
			response_types_supported: ['code'],
			subject_types_supported: ['public'],
			id_token_signing_alg_values_supported: ['RS256'],
			scopes_supported: ['openid', 'profile', 'email'],
			token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
			claims_supported: ['sub', 'name', 'picture', 'email']
		};
	},

	/**
	 * JWKS endpoint (public keys for token verification)
	 */
	async getJWKS() {
		const { publicJWK } = await getOrGenerateKeys();
		return {
			keys: [publicJWK]
		};
	},

	/**
	 * Authorize endpoint - initiates Steam OpenID flow
	 */
	async authorize(params: {
		client_id: string;
		redirect_uri: string;
		response_type: string;
		scope: string;
		state: string;
		code_challenge?: string;
		code_challenge_method?: string;
	}, origin: string): Promise<{ redirectUrl: string } | { error: string }> {
		// Validate required params
		if (!params.client_id || params.client_id !== getClientId()) {
			return { error: 'invalid_client' };
		}

		if (params.response_type !== 'code') {
			return { error: 'unsupported_response_type' };
		}

		if (!params.redirect_uri || !isRedirectUriAllowed(params.redirect_uri, origin)) {
			return { error: 'invalid_redirect_uri' };
		}

		if (!params.state) {
			return { error: 'invalid_request' };
		}

		// PKCE required
		if (!params.code_challenge || params.code_challenge_method !== 'S256') {
			return { error: 'invalid_request' };
		}

		// Build Steam OpenID request
		const callbackUrl = new URL('/auth/steam/oidc/callback', origin);
		callbackUrl.searchParams.set('state', params.state);
		callbackUrl.searchParams.set('redirect_uri', params.redirect_uri);
		callbackUrl.searchParams.set('code_challenge', params.code_challenge);

		const steamParams = new URLSearchParams({
			'openid.ns': 'http://specs.openid.net/auth/2.0',
			'openid.mode': 'checkid_setup',
			'openid.return_to': callbackUrl.toString(),
			'openid.realm': origin,
			'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
			'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
		});

		return {
			redirectUrl: `${STEAM_OPENID_URL}?${steamParams.toString()}`
		};
	},

	/**
	 * Steam callback - verifies Steam response and generates authorization code
	 */
	async handleSteamCallback(searchParams: URLSearchParams, origin: string): Promise<{ redirectUrl: string } | { error: string }> {
		// Extract our state params
		const state = searchParams.get('state');
		const redirectUri = searchParams.get('redirect_uri');
		const codeChallenge = searchParams.get('code_challenge');

		if (!state || !redirectUri || !codeChallenge) {
			return { error: 'invalid_state' };
		}

		// Verify Steam response
		const mode = searchParams.get('openid.mode');
		if (mode === 'cancel') {
			const errorUrl = new URL(redirectUri);
			errorUrl.searchParams.set('error', 'access_denied');
			errorUrl.searchParams.set('state', state);
			return { redirectUrl: errorUrl.toString() };
		}

		if (mode !== 'id_res') {
			return { error: 'invalid_openid_response' };
		}

		// Security checks
		const opEndpoint = searchParams.get('openid.op_endpoint');
		if (opEndpoint !== STEAM_OPENID_URL) {
			return { error: 'invalid_provider' };
		}

		const claimedId = searchParams.get('openid.claimed_id');
		const identity = searchParams.get('openid.identity');

		if (!claimedId || !identity || claimedId !== identity) {
			return { error: 'identity_mismatch' };
		}

		const steamId = extractSteamId(claimedId);
		if (!steamId) {
			return { error: 'invalid_steam_id' };
		}

		// Verify signature with Steam
		const isValid = await verifyOpenIdSignature(searchParams);
		if (!isValid) {
			return { error: 'signature_verification_failed' };
		}

		// Generate authorization code
		const code = generateCode();
		pendingCodes.set(code, {
			code,
			steamId,
			redirectUri,
			codeChallenge,
			createdAt: Date.now()
		});

		// Redirect back to Supabase with code
		const successUrl = new URL(redirectUri);
		successUrl.searchParams.set('code', code);
		successUrl.searchParams.set('state', state);

		return { redirectUrl: successUrl.toString() };
	},

	/**
	 * Token endpoint - exchanges authorization code for tokens
	 */
	async token(params: {
		grant_type: string;
		code: string;
		redirect_uri: string;
		code_verifier: string;
		client_id: string;
		client_secret: string;
	}, origin: string): Promise<{ access_token: string; token_type: string; expires_in: number; id_token: string } | { error: string }> {
		// Validate grant_type
		if (params.grant_type !== 'authorization_code') {
			return { error: 'unsupported_grant_type' };
		}

		// Verify client
		if (params.client_id !== getClientId() || !verifyClientSecret(params.client_secret)) {
			return { error: 'invalid_client' };
		}

		// Look up authorization code
		const codeData = pendingCodes.get(params.code);
		if (!codeData) {
			return { error: 'invalid_grant' };
		}

		// Check expiration
		if (Date.now() - codeData.createdAt > CODE_TTL_MS) {
			pendingCodes.delete(params.code);
			return { error: 'invalid_grant' };
		}

		// Verify redirect_uri matches
		if (params.redirect_uri !== codeData.redirectUri) {
			return { error: 'invalid_grant' };
		}

		// Verify PKCE
		const computedChallenge = await hashCodeVerifier(params.code_verifier);
		if (computedChallenge !== codeData.codeChallenge) {
			return { error: 'invalid_grant' };
		}

		// Code is single-use
		pendingCodes.delete(params.code);

		// Fetch Steam persona
		const persona = await fetchSteamPersona(codeData.steamId);

		// Generate tokens
		const issuer = getIssuer(origin);
		const sub = `steam:${codeData.steamId}`;
		const { privateKey } = await getOrGenerateKeys();

		const now = Math.floor(Date.now() / 1000);

		const idToken = await new SignJWT({
			sub,
			name: persona?.personaname || `Player_${codeData.steamId.slice(-6)}`,
			picture: persona?.avatarfull || '',
			email: `steam_${codeData.steamId}@users.tyrhq.invalid`,
			steam_id: codeData.steamId
		})
			.setProtectedHeader({ alg: 'RS256', kid: 'steam-oidc-1' })
			.setIssuedAt(now)
			.setExpirationTime(now + TOKEN_TTL_SECONDS)
			.setIssuer(issuer)
			.setAudience(getClientId())
			.sign(privateKey);

		const accessToken = await new SignJWT({
			sub,
			steam_id: codeData.steamId
		})
			.setProtectedHeader({ alg: 'RS256', kid: 'steam-oidc-1' })
			.setIssuedAt(now)
			.setExpirationTime(now + TOKEN_TTL_SECONDS)
			.setIssuer(issuer)
			.setAudience(getClientId())
			.sign(privateKey);

		return {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: TOKEN_TTL_SECONDS,
			id_token: idToken
		};
	},

	/**
	 * Userinfo endpoint - returns user claims
	 */
	async userinfo(accessToken: string, origin: string): Promise<{ sub: string; name: string; picture: string; email: string; steam_id: string } | { error: string }> {
		try {
			const issuer = getIssuer(origin);
			const { publicJWK } = await getOrGenerateKeys();
			
			// Verify access token
			const { payload } = await jwtVerify(accessToken, await crypto.subtle.importKey(
				'jwk',
				publicJWK,
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['verify']
			), {
				issuer,
				audience: getClientId()
			});

			const steamId = payload.steam_id as string;
			if (!steamId) {
				return { error: 'invalid_token' };
			}

			// Fetch fresh persona
			const persona = await fetchSteamPersona(steamId);

			return {
				sub: payload.sub as string,
				name: persona?.personaname || `Player_${steamId.slice(-6)}`,
				picture: persona?.avatarfull || '',
				email: `steam_${steamId}@users.tyrhq.invalid`,
				steam_id: steamId
			};
		} catch (err) {
			console.error('[steam-oidc] Token verification failed:', err);
			return { error: 'invalid_token' };
		}
	}
};

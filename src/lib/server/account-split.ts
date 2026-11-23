/**
 * Account split utilities
 * Handles secure split cookie creation and validation for splitting sign-in methods
 */

import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';
import crypto from 'crypto';

const SPLIT_COOKIE_NAME = 'tyrq_split';
const SPLIT_COOKIE_MAX_AGE = 10 * 60; // 10 minutes in seconds

/**
 * Get and validate split secret (reuses MERGE_SECRET)
 * @throws Error if secret is missing or too short
 */
export function getSplitSecret(): string {
	const secret = privateEnv.MERGE_SECRET;
	
	if (!secret) {
		throw new Error('MERGE_SECRET environment variable is required');
	}
	
	if (secret.length < 32) {
		throw new Error('MERGE_SECRET must be at least 32 bytes (32+ characters)');
	}
	
	return secret;
}

export interface SplitCookieData {
	nonce: string;
	currentUserId: string;
	provider: 'google' | 'email' | 'steam';
	identityId?: string; // Identity ID for all providers
	phase: 'initiated' | 'authenticated';
	issuedAt: number;
	expiresAt: number;
}

/**
 * Create a signed split cookie
 * @param currentUserId The current user's ID
 * @param provider Which sign-in method to split off
 * @param identityId Identity ID for the provider to split
 * @param phase 'initiated' or 'authenticated'
 * @returns Cookie value and options
 */
export function createSplitCookie(
	currentUserId: string,
	provider: 'google' | 'email' | 'steam',
	identityId?: string,
	phase: 'initiated' | 'authenticated' = 'initiated'
): {
	value: string;
	options: {
		path: string;
		httpOnly: boolean;
		secure: boolean;
		sameSite: 'lax';
		maxAge: number;
	};
} {
	const nonce = crypto.randomBytes(32).toString('hex');
	const issuedAt = Date.now();
	const expiresAt = issuedAt + SPLIT_COOKIE_MAX_AGE * 1000;

	const data: SplitCookieData = {
		nonce,
		currentUserId,
		provider,
		identityId,
		phase,
		issuedAt,
		expiresAt
	};

	const payload = JSON.stringify(data);
	const secret = getSplitSecret();
	const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

	const cookieValue = `${Buffer.from(payload).toString('base64')}.${signature}`;

	return {
		value: cookieValue,
		options: {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: SPLIT_COOKIE_MAX_AGE
		}
	};
}

/**
 * Verify and parse a split cookie
 * @param cookieValue The cookie value from the request
 * @returns Parsed cookie data or null if invalid/expired
 */
export function verifySplitCookie(cookieValue: string | undefined): SplitCookieData | null {
	if (!cookieValue) {
		return null;
	}

	try {
		const [payloadB64, signature] = cookieValue.split('.');
		if (!payloadB64 || !signature) {
			return null;
		}

		const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
		const secret = getSplitSecret();
		const expectedSignature = crypto
			.createHmac('sha256', secret)
			.update(payload)
			.digest('hex');

		if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
			return null;
		}

		const data: SplitCookieData = JSON.parse(payload);

		if (Date.now() > data.expiresAt) {
			return null;
		}

		if (!data.nonce || !data.currentUserId || !data.expiresAt || !data.phase || !data.issuedAt || !data.provider) {
			return null;
		}

		return data;
	} catch {
		return null;
	}
}

/**
 * Delete the split cookie
 */
export function deleteSplitCookie(): {
	value: string;
	options: {
		path: string;
		httpOnly: boolean;
		secure: boolean;
		sameSite: 'lax';
		maxAge: number;
	};
} {
	return {
		value: '',
		options: {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: 0
		}
	};
}

export { SPLIT_COOKIE_NAME };

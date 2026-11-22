/**
 * Account merge utilities
 * Handles secure merge cookie creation and validation
 */

import { dev } from '$app/environment';
import crypto from 'crypto';

const MERGE_COOKIE_NAME = 'tyrq_merge';
const MERGE_COOKIE_MAX_AGE = 10 * 60; // 10 minutes in seconds

/**
 * Get and validate merge secret
 * @throws Error if secret is missing or too short
 */
export function getMergeSecret(): string {
	const secret = process.env.MERGE_SECRET;
	
	if (!secret) {
		throw new Error('MERGE_SECRET environment variable is required');
	}
	
	// Require at least 32 bytes (64 hex chars or equivalent)
	if (secret.length < 32) {
		throw new Error('MERGE_SECRET must be at least 32 bytes (64 characters)');
	}
	
	return secret;
}

export interface MergeCookieData {
	nonce: string;
	primaryUserId: string;
	secondaryUserId?: string;
	phase: 'initiated' | 'authenticated';
	issuedAt: number;
	expiresAt: number;
}

/**
 * Create a signed merge cookie
 * @param primaryUserId The primary (target) user ID
 * @param secondaryUserId Optional secondary user ID (set after authentication)
 * @param phase 'initiated' or 'authenticated'
 * @returns Cookie value and options
 */
export function createMergeCookie(
	primaryUserId: string,
	secondaryUserId?: string,
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
	const expiresAt = issuedAt + MERGE_COOKIE_MAX_AGE * 1000;

	const data: MergeCookieData = {
		nonce,
		primaryUserId,
		secondaryUserId,
		phase,
		issuedAt,
		expiresAt
	};

	const payload = JSON.stringify(data);
	const secret = getMergeSecret();
	const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

	const cookieValue = `${Buffer.from(payload).toString('base64')}.${signature}`;

	return {
		value: cookieValue,
		options: {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: MERGE_COOKIE_MAX_AGE
		}
	};
}

/**
 * Verify and parse a merge cookie
 * @param cookieValue The cookie value from the request
 * @returns Parsed cookie data or null if invalid/expired
 */
export function verifyMergeCookie(cookieValue: string | undefined): MergeCookieData | null {
	if (!cookieValue) {
		return null;
	}

	try {
		const [payloadB64, signature] = cookieValue.split('.');
		if (!payloadB64 || !signature) {
			return null;
		}

		const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
		const secret = getMergeSecret();
		const expectedSignature = crypto
			.createHmac('sha256', secret)
			.update(payload)
			.digest('hex');

		// Constant-time comparison
		if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
			return null;
		}

		const data: MergeCookieData = JSON.parse(payload);

		// Check expiry
		if (Date.now() > data.expiresAt) {
			return null;
		}

		// Validate structure
		if (!data.nonce || !data.primaryUserId || !data.expiresAt || !data.phase || !data.issuedAt) {
			return null;
		}

		return data;
	} catch {
		return null;
	}
}

/**
 * Delete the merge cookie
 */
export function deleteMergeCookie(): {
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

export { MERGE_COOKIE_NAME };

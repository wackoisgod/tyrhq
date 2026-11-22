/**
 * Account merge utilities
 * Handles secure merge cookie creation and validation
 */

import { dev } from '$app/environment';
import crypto from 'crypto';

const MERGE_COOKIE_NAME = 'tyrq_merge';
const MERGE_COOKIE_MAX_AGE = 10 * 60; // 10 minutes in seconds
const MERGE_SECRET = process.env.MERGE_SECRET || 'dev-merge-secret-change-in-production';

export interface MergeCookieData {
	nonce: string;
	primaryUserId: string;
	expiresAt: number;
}

/**
 * Create a signed merge cookie
 * @param primaryUserId The primary (target) user ID
 * @returns Cookie value and options
 */
export function createMergeCookie(primaryUserId: string): {
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
	const expiresAt = Date.now() + MERGE_COOKIE_MAX_AGE * 1000;

	const data: MergeCookieData = {
		nonce,
		primaryUserId,
		expiresAt
	};

	const payload = JSON.stringify(data);
	const signature = crypto.createHmac('sha256', MERGE_SECRET).update(payload).digest('hex');

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
		const expectedSignature = crypto
			.createHmac('sha256', MERGE_SECRET)
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
		if (!data.nonce || !data.primaryUserId || !data.expiresAt) {
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

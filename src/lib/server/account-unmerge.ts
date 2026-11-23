/**
 * Account unmerge utilities
 * Handles secure unmerge cookie creation and validation
 */

import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';
import crypto from 'crypto';

const UNMERGE_COOKIE_NAME = 'tyrq_unmerge';
const UNMERGE_COOKIE_MAX_AGE = 10 * 60; // 10 minutes in seconds

/**
 * Get and validate unmerge secret (reuses MERGE_SECRET)
 */
export function getUnmergeSecret(): string {
	const secret = privateEnv.MERGE_SECRET;
	
	if (!secret) {
		throw new Error('MERGE_SECRET environment variable is required');
	}
	
	if (secret.length < 32) {
		throw new Error('MERGE_SECRET must be at least 32 bytes');
	}
	
	return secret;
}

export interface UnmergeCookieData {
	nonce: string;
	primaryUserId: string;
	mergeId: string;
	phase: 'initiated' | 'authenticated';
	issuedAt: number;
	expiresAt: number;
}

/**
 * Create a signed unmerge cookie
 */
export function createUnmergeCookie(
	primaryUserId: string,
	mergeId: string,
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
	const expiresAt = issuedAt + UNMERGE_COOKIE_MAX_AGE * 1000;

	const data: UnmergeCookieData = {
		nonce,
		primaryUserId,
		mergeId,
		phase,
		issuedAt,
		expiresAt
	};

	const payload = JSON.stringify(data);
	const secret = getUnmergeSecret();
	const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

	const cookieValue = `${Buffer.from(payload).toString('base64')}.${signature}`;

	return {
		value: cookieValue,
		options: {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: UNMERGE_COOKIE_MAX_AGE
		}
	};
}

/**
 * Verify and parse an unmerge cookie
 */
export function verifyUnmergeCookie(cookieValue: string | undefined): UnmergeCookieData | null {
	if (!cookieValue) {
		return null;
	}

	try {
		const [payloadB64, signature] = cookieValue.split('.');
		if (!payloadB64 || !signature) {
			return null;
		}

		const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
		const secret = getUnmergeSecret();
		const expectedSignature = crypto
			.createHmac('sha256', secret)
			.update(payload)
			.digest('hex');

		if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
			return null;
		}

		const data: UnmergeCookieData = JSON.parse(payload);

		if (Date.now() > data.expiresAt) {
			return null;
		}

		if (!data.nonce || !data.primaryUserId || !data.mergeId || !data.expiresAt || !data.phase || !data.issuedAt) {
			return null;
		}

		return data;
	} catch {
		return null;
	}
}

/**
 * Delete the unmerge cookie
 */
export function deleteUnmergeCookie(): {
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

export { UNMERGE_COOKIE_NAME };

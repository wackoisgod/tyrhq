import { createHash, randomBytes } from 'node:crypto';

import { getSupabaseAdminClient } from './supabase-admin';

const API_CREDENTIAL_SELECT =
	'id, user_id, key_prefix, key_hash, status, created_at, rotated_at, revoked_at, last_used_at';
const API_KEY_PREFIX = 'tyr_live_';
const API_KEY_PREFIX_LENGTH = 18;

export const PUBLIC_API_RATE_LIMITS = {
	perMinute: 60,
	perDay: 5_000,
	perIpPerMinute: 120
} as const;

export type ApiCredentialRecord = {
	id: string;
	user_id: string;
	key_prefix: string | null;
	key_hash: string | null;
	status: 'active' | 'revoked';
	created_at: string;
	rotated_at: string | null;
	revoked_at: string | null;
	last_used_at: string | null;
};

export type ApiCredentialSummary = {
	status: 'missing' | 'active' | 'revoked';
	hasActiveKey: boolean;
	fingerprint: string | null;
	createdAt: string | null;
	rotatedAt: string | null;
	revokedAt: string | null;
	lastUsedAt: string | null;
};

function requireAdminClient() {
	const admin = getSupabaseAdminClient();

	if (!admin) {
		throw new Error('Supabase admin client is not configured');
	}

	return admin;
}

export function hashApiKey(apiKey: string) {
	return createHash('sha256').update(apiKey).digest('hex');
}

export function createApiKeyMaterial() {
	const secret = randomBytes(24).toString('base64url');
	const apiKey = `${API_KEY_PREFIX}${secret}`;

	return {
		apiKey,
		keyPrefix: apiKey.slice(0, API_KEY_PREFIX_LENGTH),
		keyHash: hashApiKey(apiKey)
	};
}

export function readApiKeyFromAuthorization(header: string | null) {
	if (!header) return null;

	const [scheme, value] = header.split(/\s+/, 2);
	if (scheme?.toLowerCase() !== 'bearer' || !value?.trim()) {
		return null;
	}

	return value.trim();
}

export function toApiCredentialSummary(record: ApiCredentialRecord | null): ApiCredentialSummary {
	if (!record) {
		return {
			status: 'missing',
			hasActiveKey: false,
			fingerprint: null,
			createdAt: null,
			rotatedAt: null,
			revokedAt: null,
			lastUsedAt: null
		};
	}

	return {
		status: record.status,
		hasActiveKey: record.status === 'active' && Boolean(record.key_hash),
		fingerprint: record.key_prefix ? `${record.key_prefix}...` : null,
		createdAt: record.created_at,
		rotatedAt: record.rotated_at,
		revokedAt: record.revoked_at,
		lastUsedAt: record.last_used_at
	};
}

export async function getUserApiCredentialRecord(userId: string) {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('api_credentials')
		.select(API_CREDENTIAL_SELECT)
		.eq('user_id', userId)
		.maybeSingle<ApiCredentialRecord>();

	if (error) {
		throw new Error(error.message);
	}

	return data;
}

export async function getUserApiCredentialSummary(userId: string) {
	const record = await getUserApiCredentialRecord(userId);
	return toApiCredentialSummary(record);
}

export async function issueUserApiKey(userId: string) {
	const admin = requireAdminClient();
	const existing = await getUserApiCredentialRecord(userId);
	const material = createApiKeyMaterial();
	const now = new Date().toISOString();

	const mutation = existing
		? admin
				.from('api_credentials')
				.update({
					key_prefix: material.keyPrefix,
					key_hash: material.keyHash,
					status: 'active',
					rotated_at: now,
					revoked_at: null
				})
				.eq('user_id', userId)
		: admin.from('api_credentials').insert({
				user_id: userId,
				key_prefix: material.keyPrefix,
				key_hash: material.keyHash,
				status: 'active'
			});

	const { data, error } = await mutation.select(API_CREDENTIAL_SELECT).single<ApiCredentialRecord>();

	if (error) {
		throw new Error(error.message);
	}

	return {
		apiKey: material.apiKey,
		credential: data,
		replacedExistingKey: Boolean(existing?.key_hash)
	};
}

export async function revokeUserApiKey(userId: string) {
	const admin = requireAdminClient();
	const existing = await getUserApiCredentialRecord(userId);

	if (!existing) {
		return toApiCredentialSummary(null);
	}

	const { data, error } = await admin
		.from('api_credentials')
		.update({
			key_prefix: null,
			key_hash: null,
			status: 'revoked',
			revoked_at: new Date().toISOString()
		})
		.eq('user_id', userId)
		.select(API_CREDENTIAL_SELECT)
		.single<ApiCredentialRecord>();

	if (error) {
		throw new Error(error.message);
	}

	return toApiCredentialSummary(data);
}

export async function findApiCredentialByKeyHash(keyHash: string) {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('api_credentials')
		.select(API_CREDENTIAL_SELECT)
		.eq('key_hash', keyHash)
		.maybeSingle<ApiCredentialRecord>();

	if (error) {
		throw new Error(error.message);
	}

	return data;
}

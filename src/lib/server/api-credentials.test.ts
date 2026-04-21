import { describe, expect, it } from 'vitest';

import {
	createApiKeyMaterial,
	hashApiKey,
	readApiKeyFromAuthorization,
	toApiCredentialSummary
} from './api-credentials';

describe('createApiKeyMaterial', () => {
	it('creates a prefixed key and matching hash', () => {
		const material = createApiKeyMaterial();

		expect(material.apiKey.startsWith('tyr_live_')).toBe(true);
		expect(material.keyPrefix.length).toBeGreaterThan(8);
		expect(material.keyHash).toBe(hashApiKey(material.apiKey));
	});
});

describe('readApiKeyFromAuthorization', () => {
	it('reads bearer tokens', () => {
		expect(readApiKeyFromAuthorization('Bearer tyr_live_test')).toBe('tyr_live_test');
	});

	it('rejects malformed authorization headers', () => {
		expect(readApiKeyFromAuthorization('Basic abc123')).toBeNull();
		expect(readApiKeyFromAuthorization(null)).toBeNull();
	});
});

describe('toApiCredentialSummary', () => {
	it('returns a missing summary when there is no credential', () => {
		expect(toApiCredentialSummary(null)).toEqual({
			status: 'missing',
			hasActiveKey: false,
			fingerprint: null,
			createdAt: null,
			rotatedAt: null,
			revokedAt: null,
			lastUsedAt: null
		});
	});
});

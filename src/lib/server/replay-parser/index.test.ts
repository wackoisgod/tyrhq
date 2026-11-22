/**
 * Tests for Tyr replay parser
 *
 * Uses minimal synthetic byte fixtures to test structural parsing
 * without committing real replay files.
 */

import { describe, it, expect } from 'vitest';
import { ReplayParseError } from './index';

describe('ReplayParser', () => {
	describe('ByteReader', () => {
		it('should reject files exceeding MAX_FILE_SIZE', async () => {
			const { parseReplay } = await import('./index');
			const hugeBuffer = Buffer.alloc(101 * 1024 * 1024); // 101 MB

			await expect(parseReplay(hugeBuffer)).rejects.toThrow(ReplayParseError);
			await expect(parseReplay(hugeBuffer)).rejects.toThrow('too large');
		});

		it('should reject invalid magic number', async () => {
			const { parseReplay } = await import('./index');
			const badMagic = Buffer.alloc(100);
			badMagic.writeUInt32LE(0x12345678, 0); // Wrong magic

			await expect(parseReplay(badMagic)).rejects.toThrow(ReplayParseError);
			await expect(parseReplay(badMagic)).rejects.toThrow('Invalid replay magic');
		});

		it('should reject unsupported file version', async () => {
			const { parseReplay } = await import('./index');
			const buffer = Buffer.alloc(100);
			buffer.writeUInt32LE(0x1ca2e27f, 0); // Correct magic
			buffer.writeUInt32LE(5, 4); // Wrong version (expected 7)

			await expect(parseReplay(buffer)).rejects.toThrow(ReplayParseError);
			await expect(parseReplay(buffer)).rejects.toThrow('Unsupported file version');
		});
	});

	describe('Tank codename mapping', () => {
		it('should map Bush to Ark', async () => {
			const { mapTankCodename } = await import('./index');
			const result = await mapTankCodename('Bush');
			expect(result).toBe('Ark');
		});

		it('should map bush (lowercase) to Ark', async () => {
			const { mapTankCodename } = await import('./index');
			const result = await mapTankCodename('bush');
			expect(result).toBe('Ark');
		});

		it('should return undefined for unknown codenames', async () => {
			const { mapTankCodename } = await import('./index');
			const result = await mapTankCodename('NonexistentTank');
			expect(result).toBeUndefined();
		});
	});

	describe('Steam OpenID extraction', () => {
		it('should extract SteamID64 from claimed_id', () => {
			// This would be tested in the auth callback module
			// Just ensuring the pattern is correct
			const STEAM_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

			const validId = 'https://steamcommunity.com/openid/id/76561198012345678';
			const match = validId.match(STEAM_ID_REGEX);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('76561198012345678');
		});

		it('should reject invalid claimed_id formats', () => {
			const STEAM_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

			const invalid = [
				'https://steamcommunity.com/profiles/76561198012345678',
				'https://steamcommunity.com/openid/id/abc',
				'not-a-url',
				''
			];

			for (const id of invalid) {
				const match = id.match(STEAM_ID_REGEX);
				expect(match).toBeNull();
			}
		});
	});
});

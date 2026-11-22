import { describe, it, expect } from 'vitest';
import { parseReplay, isValidReplay } from './parser';
import { probeReplayHeader } from './probe';

describe('Replay Parser', () => {
	describe('isValidReplay', () => {
		it('rejects empty buffer', () => {
			expect(isValidReplay(new Uint8Array([]))).toBe(false);
		});

		it('rejects invalid magic', () => {
			const buffer = new Uint8Array(64);
			buffer[0] = 0x00;
			buffer[1] = 0x00;
			buffer[2] = 0x00;
			buffer[3] = 0x00;
			expect(isValidReplay(buffer)).toBe(false);
		});

		it('accepts valid magic', () => {
			const buffer = new Uint8Array(256);
			let offset = 0;

			// Magic
			buffer[offset++] = 0x7f;
			buffer[offset++] = 0xe2;
			buffer[offset++] = 0xa2;
			buffer[offset++] = 0x1c;

			// File version
			buffer[offset++] = 7;
			offset += 3; // padding

			// LengthInMS
			offset += 4;

			// NetworkVersion
			offset += 4;

			// Changelist
			buffer[offset++] = 100;
			offset += 3; // rest of u32

			// FriendlyName (empty string)
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;

			// IsLive
			offset += 4;

			// Timestamp
			offset += 8;

			// IsCompressed
			offset += 4;

			// IsEncrypted
			offset += 4;

			// EncryptionKey array (count=0)
			buffer[offset++] = 0;
			offset += 3; // rest of u32

			// GUID (16 bytes of non-zero)
			for (let i = 0; i < 16; i++) {
				buffer[offset + i] = i + 1;
			}

			expect(isValidReplay(buffer)).toBe(true);
		});
	});

	describe('parseReplay', () => {
		it('returns empty result for invalid file', () => {
			const result = parseReplay(new Uint8Array([]));
			expect(result.replayGuid).toBeNull();
			expect(result.changelist).toBeNull();
			expect(result.warnings.length).toBeGreaterThan(0);
		});

		it('extracts GUID and changelist from valid header', () => {
			const buffer = new Uint8Array(256);
			let offset = 0;

			// Magic
			buffer[offset++] = 0x7f;
			buffer[offset++] = 0xe2;
			buffer[offset++] = 0xa2;
			buffer[offset++] = 0x1c;

			// File version
			buffer[offset++] = 7;
			offset += 3;

			// LengthInMS
			offset += 4;

			// NetworkVersion
			offset += 4;

			// Changelist (little-endian 0x1234)
			buffer[offset++] = 0x34;
			buffer[offset++] = 0x12;
			buffer[offset++] = 0x00;
			buffer[offset++] = 0x00;

			// FriendlyName (empty)
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;

			// IsLive
			offset += 4;

			// Timestamp (8 bytes)
			offset += 8;

			// IsCompressed
			offset += 4;

			// IsEncrypted
			offset += 4;

			// EncryptionKey (count=0)
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;

			// GUID
			for (let i = 0; i < 16; i++) {
				buffer[offset + i] = 0xa0 + i;
			}

			const result = parseReplay(buffer);
			expect(result.replayGuid).toBe('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf');
			expect(result.changelist).toBe(0x1234);
		});

		it('reports netstream parsing not implemented', () => {
			const buffer = new Uint8Array(128);

			// Valid header
			buffer[0] = 0x7f;
			buffer[1] = 0xe2;
			buffer[2] = 0xa2;
			buffer[3] = 0x1c;
			buffer[4] = 7;

			// Skip to GUID
			let offset = 20;
			// Empty FriendlyName
			buffer[offset] = 0;
			offset += 4;
			// IsLive
			offset += 4;
			// Timestamp
			offset += 8;
			// IsCompressed
			offset += 4;
			// IsEncrypted
			offset += 4;
			// EncryptionKey count
			buffer[offset] = 0;
			offset += 4;

			// GUID
			for (let i = 0; i < 16; i++) {
				buffer[offset + i] = i;
			}

			const result = parseReplay(buffer);
			expect(result.warnings).toContain(
				'Netstream parsing not yet implemented - roster and stats unavailable'
			);
			expect(result.roster).toEqual([]);
			expect(result.endgameStats).toEqual([]);
		});
	});

	describe('probeReplayHeader', () => {
		it('returns null for too-short buffer', () => {
			expect(probeReplayHeader(new Uint8Array(10))).toBeNull();
		});

		it('parses valid header', () => {
			const buffer = new Uint8Array(256);
			let offset = 0;

			// Magic
			buffer[offset++] = 0x7f;
			buffer[offset++] = 0xe2;
			buffer[offset++] = 0xa2;
			buffer[offset++] = 0x1c;

			// File version
			buffer[offset++] = 7;
			offset += 3;

			// LengthInMS
			offset += 4;

			// NetworkVersion
			offset += 4;

			// Changelist (0xdeadbeef little-endian)
			buffer[offset++] = 0xef;
			buffer[offset++] = 0xbe;
			buffer[offset++] = 0xad;
			buffer[offset++] = 0xde;

			// FriendlyName (empty)
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;

			// IsLive
			offset += 4;

			// Timestamp
			offset += 8;

			// IsCompressed
			offset += 4;

			// IsEncrypted
			offset += 4;

			// EncryptionKey
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;
			buffer[offset++] = 0;

			// GUID
			for (let i = 0; i < 16; i++) {
				buffer[offset + i] = 0xf0 + i;
			}

			const header = probeReplayHeader(buffer);
			expect(header).not.toBeNull();
			expect(header!.changelist).toBe(0xdeadbeef);
			expect(header!.guid).toBe('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
		});
	});
});

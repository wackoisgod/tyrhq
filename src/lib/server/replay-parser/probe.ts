/**
 * Replay file header parsing (probe.py equivalent).
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 *
 * Reads the top-level ReplayInfo structure to extract:
 * - Replay GUID (16-byte unique identifier)
 * - Changelist/version
 * - Chunk list structure
 */

import { DecodeError } from './bit-reader';

interface ReplayHeader {
	guid: string; // 16-byte hex string
	changelist: number;
	chunks: Array<{
		type: number;
		offset: number;
		size: number;
	}>;
}

/**
 * Read a 32-bit little-endian uint from buffer at offset.
 */
function readU32LE(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] |
		(buffer[offset + 1] << 8) |
		(buffer[offset + 2] << 16) |
		(buffer[offset + 3] << 24)) >>> 0
	);
}

/**
 * Read FString (int32 length prefix + UTF-8 or UTF-16LE data).
 */
function readFString(buffer: Uint8Array, offset: number): [string, number] {
	if (offset + 4 > buffer.length) {
		throw new DecodeError('Buffer too short for FString length');
	}
	const len = readU32LE(buffer, offset);
	const signed = len & 0x80000000 ? len - 0x100000000 : len;
	let newOffset = offset + 4;

	if (signed === 0) {
		return ['', newOffset];
	}

	if (signed > 0) {
		// UTF-8
		if (newOffset + signed > buffer.length) {
			throw new DecodeError('Buffer too short for UTF-8 FString data');
		}
		const bytes = buffer.slice(newOffset, newOffset + signed);
		const decoder = new TextDecoder('utf-8', { fatal: false });
		const text = decoder.decode(bytes).replace(/\0+$/, '');
		return [text, newOffset + signed];
	} else {
		// UTF-16LE
		const absLen = -signed;
		const byteLen = absLen * 2;
		if (newOffset + byteLen > buffer.length) {
			throw new DecodeError('Buffer too short for UTF-16 FString data');
		}
		const bytes = buffer.slice(newOffset, newOffset + byteLen);
		const decoder = new TextDecoder('utf-16le', { fatal: false });
		const text = decoder.decode(bytes).replace(/\0+$/, '');
		return [text, newOffset + byteLen];
	}
}

/**
 * Parse minimal replay header to extract GUID and changelist.
 * Returns null if the file is not a valid Tyr replay.
 */
export function probeReplayHeader(buffer: Uint8Array): ReplayHeader | null {
	try {
		if (buffer.length < 64) {
			return null;
		}

		let offset = 0;

		// Magic: should be a known Unreal replay magic
		const magic = readU32LE(buffer, offset);
		offset += 4;
		if (magic !== 0x1ca2e27f && magic !== 0x2cf5a13d) {
			// Known Unreal replay magics
			return null;
		}

		// File version (should be 7 for Tyr)
		const fileVersion = readU32LE(buffer, offset);
		offset += 4;

		// LengthInMS
		offset += 4;

		// NetworkVersion
		offset += 4;

		// Changelist
		const changelist = readU32LE(buffer, offset);
		offset += 4;

		// FriendlyName FString
		const [, afterFriendlyName] = readFString(buffer, offset);
		offset = afterFriendlyName;

		// IsLive
		offset += 4;

		// Timestamp (int64)
		offset += 8;

		// IsCompressed
		offset += 4;

		// IsEncrypted
		offset += 4;

		// EncryptionKey (array of bytes, int32 count + data)
		if (offset + 4 > buffer.length) {
			return null;
		}
		const encKeyCount = readU32LE(buffer, offset);
		offset += 4 + encKeyCount;

		// GUID (16 bytes)
		if (offset + 16 > buffer.length) {
			return null;
		}
		const guidBytes = buffer.slice(offset, offset + 16);
		const guid = Array.from(guidBytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		offset += 16;

		// We have enough for our purposes
		return {
			guid,
			changelist,
			chunks: [] // We don't need to parse chunks for basic metadata
		};
	} catch (e) {
		return null;
	}
}

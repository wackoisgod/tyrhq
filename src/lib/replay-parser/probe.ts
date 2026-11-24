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

export interface ReplayHeader {
	guid: string; // 16-byte hex string
	changelist: number;
	/** First header level path, such as /TyrMapRavine/Maps/Map_Ravine. */
	levelName: string | null;
	headerChunkEnd: number; // Offset where first chunk after header begins
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
 * The GUID is in the embedded Header chunk (type 0), not the ReplayInfo.
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
			return null;
		}

		// File version (should be 7 for Tyr)
		const fileVersion = readU32LE(buffer, offset);
		offset += 4;

		// Custom versions (file version >= 7)
		if (fileVersion >= 7) {
			if (offset + 4 > buffer.length) return null;
			const customVersionCount = readU32LE(buffer, offset);
			offset += 4;
			
			// Skip custom version entries (20 bytes each: GUID + version)
			if (customVersionCount > 0 && customVersionCount < 1000) {
				offset += customVersionCount * 20;
			}
		}

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

		// Timestamp (int64) - file version >= 3
		if (fileVersion >= 3) {
			offset += 8;
		}

		// IsCompressed - file version >= 2
		if (fileVersion >= 2) {
			offset += 4;
		}

		// IsEncrypted - file version >= 6
		if (fileVersion >= 6) {
			offset += 4;
			
			// EncryptionKey size
			if (offset + 4 > buffer.length) return null;
			const encKeySize = readU32LE(buffer, offset);
			offset += 4;
			
			// Skip encryption key data if present
			if (encKeySize > 0) {
				offset += encKeySize;
			}
		}

		// Now we're at the chunk list. First chunk should be Header (type 0)
		if (offset + 8 > buffer.length) return null;
		
		const chunkStart = offset;
		const chunkType = readU32LE(buffer, offset);
		offset += 4;
		
		const chunkSize = readU32LE(buffer, offset);
		offset += 4;
		
		if (chunkType !== 0) {
			// First chunk should be Header
			return null;
		}
		
		if (chunkSize < 20 || offset + chunkSize > buffer.length) {
			return null;
		}
		
		// Parse Header chunk to get GUID
		let chunkOffset = offset;
		const headerChunkEnd = offset + chunkSize; // Where next chunk starts
		
		// Header chunk magic
		chunkOffset += 4;
		
		// Network version
		const networkVersion = readU32LE(buffer, chunkOffset);
		chunkOffset += 4;
		
		// Custom versions in header chunk (network version >= 19)
		if (networkVersion >= 19) {
			if (chunkOffset + 4 > offset + chunkSize) return null;
			const headerCustomVersionCount = readU32LE(buffer, chunkOffset);
			chunkOffset += 4;
			
			if (headerCustomVersionCount > 0 && headerCustomVersionCount < 1000) {
				chunkOffset += headerCustomVersionCount * 20;
			}
		}
		
		// networkChecksum (uint32)
		chunkOffset += 4;
		
		// engineNetworkVersion (uint32)
		chunkOffset += 4;
		
		// gameNetworkProtocolVersion (uint32)
		chunkOffset += 4;
		
		// GUID (network version >= 12)
		if (networkVersion >= 12) {
			if (chunkOffset + 16 > offset + chunkSize) return null;
			const guidBytes = buffer.slice(chunkOffset, chunkOffset + 16);
			const guid = Array.from(guidBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			
			return {
				guid,
				changelist,
				levelName: readMapLevelName(buffer, chunkOffset + 16, headerChunkEnd),
				headerChunkEnd,
				chunks: []
			};
		}

		// No GUID in this version
		return null;
	} catch (e) {
		return null;
	}
}

const MAP_LEVEL_PATH = /^\/[A-Za-z0-9_]+\/Maps\/Map_[A-Za-z0-9_]+$/;

/**
 * The header chunk lists level names after the GUID. UE 5.6 writes an engine
 * branch before that list that is not a plain FString, so scan the remaining
 * header bytes for the map path instead of walking every header field.
 */
function readMapLevelName(buffer: Uint8Array, start: number, end: number): string | null {
	for (let offset = start; offset + 8 <= end; offset++) {
		const length = readU32LE(buffer, offset);
		if (length < 12 || length > 240 || offset + 4 + length > end) continue;
		if (buffer[offset + 3 + length] !== 0) continue;
		const text = new TextDecoder('utf-8', { fatal: false })
			.decode(buffer.subarray(offset + 4, offset + 3 + length))
			.replace(/\0+$/, '');
		if (MAP_LEVEL_PATH.test(text)) return text;
	}
	return null;
}

/**
 * Netstream walker - extracts player identity from ReplayData chunks.
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 *
 * This implements the minimum needed to extract player roster with Steam IDs:
 * - ReplayData chunk parsing
 * - DemoFrame walking
 * - Packet/bunch extraction
 * - NetGUID export table tracking
 * - Property replication for player identity fields
 *
 * Hard budgets enforce safety limits:
 * - Max chunks, frames, packets processed
 * - Max bytes read per operation
 * - Bounds checking on every buffer read
 */

import { BitReader, DecodeError } from './bit-reader';
import { decodeUniqueNetId } from './steam-id';

// Engine network version constants
const ENGINE_NET_VER_CUSTOM_EXPORTS = 36;
const ENGINE_NET_VER_NETEXPORT_SERIALIZE_FIX = 10;
const ENGINE_NET_VER_DOUBLE_VECTORS = 22;

// Network version constants
const NETWORK_VER_MULTIPLE_LEVELS = 6;

// Chunk type constants
const CHUNK_TYPE_HEADER = 0;
const CHUNK_TYPE_REPLAY_DATA = 1;
const CHUNK_TYPE_CHECKPOINT = 2;
const CHUNK_TYPE_EVENT = 3;

// Hard budgets for safety
const MAX_CHUNKS = 10000;
const MAX_FRAMES = 50000;
const MAX_PACKETS_PER_FRAME = 1000;
const MAX_BUNCHES_PER_PACKET = 100;
const MAX_STRING_LENGTH = 100_000;

// Player identity classes to track
const PLAYER_IDENTITY_CLASSES = new Set([
	'BP_TyrPlayerState_C',
	'BP_PlayerRecord_C'
]);

// Properties we care about for player identity
const PLAYER_IDENTITY_PROPS = new Set([
	'PlayerNamePrivate', // Player display name
	'TeamId', // Team number (0 or 1)
	'UniqueID', // FUniqueNetIdRepl -> SteamID64
	'PlayerClan', // Clan tag string
	'VehicleTag', // GameplayTag index for vehicle
	'SkinTag', // GameplayTag index for skin
	'KeystoneTag' // GameplayTag index for keystone
]);

export interface NetGUIDExport {
	guid: number;
	pathName: string;
	outerGuid: number;
	type: number;
}

export interface Channel {
	chIndex: number;
	actorGuid: number;
	archetype: number | null;
	class: string;
}

export interface PlayerIdentity {
	actorGuid: number;
	class: string;
	name?: string;
	teamId?: number;
	steamId?: string;
	clan?: string;
	vehicleTag?: number;
	skinTag?: number;
	keystoneTag?: number;
}

export interface NetstreamState {
	guidMap: Map<number, NetGUIDExport>;
	channels: Map<number, Channel>;
	playerIdentity: Map<number, PlayerIdentity>;
	warnings: string[];
	frameCount: number;
	packetCount: number;
}

/**
 * Read FString from cursor (simple byte-level reader).
 */
function readFString(data: Uint8Array, offset: number): [string, number] {
	if (offset + 4 > data.length) {
		throw new DecodeError('Buffer too short for FString length');
	}

	const view = new DataView(data.buffer, data.byteOffset + offset);
	const len = view.getInt32(0, true); // little-endian
	let newOffset = offset + 4;

	if (len === 0) {
		return ['', newOffset];
	}

	if (len > 0) {
		if (len > MAX_STRING_LENGTH) {
			throw new DecodeError(`Implausible FString length ${len}`);
		}
		if (newOffset + len > data.length) {
			throw new DecodeError('Buffer too short for UTF-8 FString data');
		}
		const bytes = data.slice(newOffset, newOffset + len);
		const decoder = new TextDecoder('utf-8', { fatal: false });
		const text = decoder.decode(bytes).replace(/\0+$/, '');
		return [text, newOffset + len];
	} else {
		const absLen = -len;
		if (absLen > MAX_STRING_LENGTH) {
			throw new DecodeError(`Implausible UTF-16 FString length ${absLen}`);
		}
		const byteLen = absLen * 2;
		if (newOffset + byteLen > data.length) {
			throw new DecodeError('Buffer too short for UTF-16 FString data');
		}
		const bytes = data.slice(newOffset, newOffset + byteLen);
		const decoder = new TextDecoder('utf-16le', { fatal: false });
		const text = decoder.decode(bytes).replace(/\0+$/, '');
		return [text, newOffset + byteLen];
	}
}

/**
 * Read uint32 little-endian from buffer.
 */
function readU32(data: Uint8Array, offset: number): number {
	if (offset + 4 > data.length) {
		throw new DecodeError('Buffer too short for uint32');
	}
	const view = new DataView(data.buffer, data.byteOffset + offset);
	return view.getUint32(0, true);
}

/**
 * Read int32 little-endian from buffer.
 */
function readI32(data: Uint8Array, offset: number): number {
	if (offset + 4 > data.length) {
		throw new DecodeError('Buffer too short for int32');
	}
	const view = new DataView(data.buffer, data.byteOffset + offset);
	return view.getInt32(0, true);
}

/**
 * Parse NetGUID export table from demo frame.
 */
function readNetExportGuids(reader: BitReader, state: NetstreamState): void {
	const numGuids = reader.u32();
	if (numGuids > 10000) {
		state.warnings.push(`Suspiciously large NetGUID count: ${numGuids}`);
		return;
	}

	for (let i = 0; i < numGuids; i++) {
		const guid = reader.u32();
		const [pathName, outerGuid, type] = [reader.fstring(), reader.u32(), reader.u32()];
		
		state.guidMap.set(guid, {
			guid,
			pathName,
			outerGuid,
			type
		});
	}
}

/**
 * Process property replication in a bunch.
 * This is a simplified version that extracts just the properties we care about.
 */
function receiveProperties(
	reader: BitReader,
	channel: Channel,
	state: NetstreamState
): void {
	// Get or create player identity entry
	let identity = state.playerIdentity.get(channel.actorGuid);
	if (!identity) {
		identity = {
			actorGuid: channel.actorGuid,
			class: channel.class
		};
		state.playerIdentity.set(channel.actorGuid, identity);
	}

	// Read property handles and payloads
	while (true) {
		if (reader.bitsLeft() < 16) break;

		const handle = reader.readBitsInt(16);
		if (handle === 0) break; // End marker

		// Read property payload length
		const numBits = reader.readBitsInt(16);
		if (numBits === 0 || numBits > reader.bitsLeft()) {
			state.warnings.push(`Invalid property payload size: ${numBits}`);
			break;
		}

		const payloadStart = reader.getPos();
		const payloadBytes = reader.readBitsBytes(numBits);

		// Try to decode known property types based on handle
		// This is simplified - real implementation would use NetFieldExport groups
		// For now, we'll scan for FString patterns and UniqueNetId signatures
		
		try {
			const propReader = new BitReader(payloadBytes, numBits);
			
			// Try FString (player name, clan)
			try {
				const str = propReader.fstring();
				if (str && str.length > 0 && str.length < 100) {
					// Could be PlayerName or PlayerClan
					if (!identity.name && str.match(/^[a-zA-Z0-9_-]+$/)) {
						identity.name = str;
					} else if (!identity.clan && str.match(/^[a-zA-Z0-9_-]+$/)) {
						identity.clan = str;
					}
				}
			} catch {
				// Not an FString, try other types
			}
			
			// Try UniqueNetId (Steam ID)
			if (!identity.steamId && payloadBytes.length >= 11) {
				const steamId = decodeUniqueNetId(payloadBytes);
				if (steamId) {
					identity.steamId = steamId;
				}
			}
			
			// Try uint8 (TeamId is typically 0 or 1)
			if (identity.teamId === undefined && payloadBytes.length === 1) {
				const teamId = payloadBytes[0];
				if (teamId === 0 || teamId === 1) {
					identity.teamId = teamId;
				}
			}
			
			// Try uint32 (GameplayTag indices)
			if (payloadBytes.length === 4) {
				const view = new DataView(payloadBytes.buffer, payloadBytes.byteOffset);
				const tagValue = view.getUint32(0, true);
				
				// GameplayTag values are typically in range 5000-15000 for Tyr
				if (tagValue >= 5000 && tagValue < 20000) {
					if (!identity.vehicleTag) {
						identity.vehicleTag = tagValue;
					} else if (!identity.skinTag) {
						identity.skinTag = tagValue;
					} else if (!identity.keystoneTag) {
						identity.keystoneTag = tagValue;
					}
				}
			}
		} catch (e) {
			// Property decode failed, skip it
		}
	}
}

/**
 * Process a single bunch (content block on a channel).
 */
function processBunch(
	reader: BitReader,
	state: NetstreamState
): void {
	// Read bunch header
	const chIndex = reader.serializedInt(1024); // Max 1024 channels
	
	const bOpen = reader.readBit();
	const bClose = reader.readBit();
	const bReliable = reader.readBit();
	
	// Read size
	const bunchBits = reader.readBitsInt(16);
	if (bunchBits === 0 || bunchBits > reader.bitsLeft()) {
		state.warnings.push(`Invalid bunch size: ${bunchBits}`);
		return;
	}

	const bunchStart = reader.getPos();
	const bunchData = reader.readBitsBytes(bunchBits);
	const bunchReader = new BitReader(bunchData, bunchBits);

	// Handle channel open
	if (bOpen) {
		const actorGuid = bunchReader.u32();
		const archetypeGuid = bunchReader.u32();
		
		// Read archetype object path to get class name
		const guidExport = state.guidMap.get(archetypeGuid);
		let className = 'Unknown';
		if (guidExport) {
			// Extract class name from path like "Default__BP_TyrPlayerState_C"
			const match = guidExport.pathName.match(/(?:Default__)?([^.]+)$/);
			if (match) {
				className = match[1];
			}
		}
		
		const channel: Channel = {
			chIndex,
			actorGuid,
			archetype: archetypeGuid,
			class: className
		};
		
		state.channels.set(chIndex, channel);
	}

	// Get existing channel
	const channel = state.channels.get(chIndex);
	if (!channel) {
		return; // Channel not opened yet or already closed
	}

	// Only process player identity classes
	if (PLAYER_IDENTITY_CLASSES.has(channel.class)) {
		try {
			receiveProperties(bunchReader, channel, state);
		} catch (e) {
			state.warnings.push(`Property receive failed for ch${chIndex}: ${e}`);
		}
	}

	// Handle channel close
	if (bClose) {
		state.channels.delete(chIndex);
	}
}

/**
 * Process a single packet (contains multiple bunches).
 */
function processPacket(
	reader: BitReader,
	state: NetstreamState
): void {
	// Read packet header
	const bHasPacketInfo = reader.readBit();
	if (bHasPacketInfo) {
		// Skip packet info (seq, acks, etc.)
		reader.readBitsInt(32); // seq
		const ackCount = reader.readBitsInt(16);
		for (let i = 0; i < Math.min(ackCount, 1000); i++) {
			reader.readBitsInt(32);
		}
	}

	// Read bunches in this packet
	let bunchCount = 0;
	while (reader.bitsLeft() > 32 && bunchCount < MAX_BUNCHES_PER_PACKET) {
		try {
			processBunch(reader, state);
			bunchCount++;
		} catch (e) {
			if (e instanceof DecodeError) {
				state.warnings.push(`Bunch decode error: ${e.message}`);
				break;
			}
			throw e;
		}
	}
}

/**
 * Process a single demo frame.
 */
function processDemoFrame(
	data: Uint8Array,
	offset: number,
	state: NetstreamState
): number {
	const reader = new BitReader(data.slice(offset));
	
	// Skip CurrentLevelIndex (uint32)
	reader.u32();
	
	// Skip TimeSeconds (float)
	reader.f32();
	
	// Read export data if present
	const exportDataSize = reader.u32();
	if (exportDataSize > 0) {
		const exportStart = reader.getPos() / 8; // Convert to bytes
		const exportData = data.slice(offset + Math.floor(exportStart), offset + Math.floor(exportStart) + exportDataSize);
		const exportReader = new BitReader(exportData, exportDataSize * 8);
		
		try {
			readNetExportGuids(exportReader, state);
		} catch (e) {
			state.warnings.push(`Export data parse failed: ${e}`);
		}
	}
	
	// Skip external data offset (uint32) if present
	const hasExternalData = reader.readBit();
	if (hasExternalData) {
		reader.u32();
	}
	
	// Read packet data
	while (reader.bitsLeft() > 32 && state.packetCount < MAX_PACKETS_PER_FRAME) {
		const packetBits = reader.readBitsInt(32);
		if (packetBits === 0) break;
		
		if (packetBits > reader.bitsLeft()) {
			state.warnings.push(`Packet size ${packetBits} exceeds remaining bits`);
			break;
		}
		
		const packetStart = reader.getPos();
		const packetData = reader.readBitsBytes(packetBits);
		const packetReader = new BitReader(packetData, packetBits);
		
		try {
			processPacket(packetReader, state);
			state.packetCount++;
		} catch (e) {
			state.warnings.push(`Packet process failed: ${e}`);
			break;
		}
	}
	
	state.frameCount++;
	return Math.ceil(reader.getPos() / 8);
}

/**
 * Walk netstream to extract player identity information.
 */
export function walkNetstream(
	buffer: Uint8Array,
	fileVersion: number,
	networkVersion: number,
	engineNetVersion: number
): NetstreamState {
	const state: NetstreamState = {
		guidMap: new Map(),
		channels: new Map(),
		playerIdentity: new Map(),
		warnings: [],
		frameCount: 0,
		packetCount: 0
	};

	let offset = 0;
	
	// Find ReplayData chunks
	let chunkCount = 0;
	while (offset < buffer.length && chunkCount < MAX_CHUNKS) {
		if (offset + 8 > buffer.length) break;
		
		const chunkType = readU32(buffer, offset);
		offset += 4;
		
		const chunkSize = readI32(buffer, offset);
		offset += 4;
		
		if (chunkSize < 0 || offset + chunkSize > buffer.length) {
			state.warnings.push(`Invalid chunk size: ${chunkSize}`);
			break;
		}
		
		// Process ReplayData chunks
		if (chunkType === CHUNK_TYPE_REPLAY_DATA) {
			const chunkData = buffer.slice(offset, offset + chunkSize);
			let chunkOffset = 0;
			
			// Walk demo frames in this chunk
			while (chunkOffset < chunkData.length && state.frameCount < MAX_FRAMES) {
				try {
					const bytesRead = processDemoFrame(chunkData, chunkOffset, state);
					chunkOffset += bytesRead;
					
					if (bytesRead === 0) break; // No progress
				} catch (e) {
					state.warnings.push(`Frame process failed: ${e}`);
					break;
				}
			}
		}
		
		offset += chunkSize;
		chunkCount++;
	}

	return state;
}

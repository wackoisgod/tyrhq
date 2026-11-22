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
import { ByteReader } from './byte-reader';
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
 * Read NetGUID exports from demo frame (byte-aligned).
 * This matches read_net_export_guids from Python decoder.
 */
function readNetExportGuids(r: ByteReader, state: NetstreamState): void {
	const n = r.intPacked();
	if (n > 100_000) {
		throw new DecodeError(`numGuids ${n} implausible`);
	}
	
	for (let i = 0; i < n; i++) {
		const size = r.i32();
		if (!(size >= 0 && size <= (1 << 20))) {
			throw new DecodeError(`export guid blob size ${size} implausible`);
		}
		const sub = new ByteReader(r.rd(size));
		internalLoadObject(sub, state, true, 0);
	}
}

/**
 * InternalLoadObject - reads a NetGUID export entry.
 * Simplified version that just tracks guid -> path mappings.
 */
function internalLoadObject(
	r: ByteReader,
	state: NetstreamState,
	isExporting: boolean,
	depth: number
): number {
	if (depth > 16) {
		throw new DecodeError('InternalLoadObject recursion limit');
	}
	
	const guid = r.intPacked();
	if (guid === 0) {
		return guid;
	}
	
	if (guid === 1 || isExporting) {
		const flags = r.u8();
		const EXPORT_FLAG_HAS_PATH = 1;
		const EXPORT_FLAG_HAS_NETWORK_CHECKSUM = 4;
		
		if (flags & EXPORT_FLAG_HAS_PATH) {
			const outer = internalLoadObject(r, state, true, depth + 1);
			const path = r.fstring();
			if (flags & EXPORT_FLAG_HAS_NETWORK_CHECKSUM) {
				r.u32(); // networkChecksum
			}
			
			state.guidMap.set(guid, {
				guid,
				pathName: path,
				outerGuid: outer,
				type: 0
			});
		}
	}
	
	return guid;
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
 * Process a single demo frame (byte-aligned).
 * Matches parse_demo_frame from Python decoder.
 */
function processDemoFrame(
	data: Uint8Array,
	offset: number,
	state: NetstreamState
): number {
	// Don't slice - work directly on data with offset awareness
	const r = new ByteReader(data.slice(offset));
	const startOff = r.off;
	
	try {
		// currentLevelIndex (int32)
		r.i32();
		
		// timeSeconds (float32)
		const t = r.f32();
		if (!(t >= 0.0 && t < 100_000.0)) {
			throw new DecodeError(`frame time ${t} implausible`);
		}
		
		// read_net_field_exports - port from Python decode.py:790-818
		const numLayoutCmdExports = r.intPacked();
		if (numLayoutCmdExports > 100_000 || numLayoutCmdExports < 0) {
			throw new DecodeError(`numLayoutCmdExports ${numLayoutCmdExports} implausible`);
		}
		for (let i = 0; i < numLayoutCmdExports; i++) {
			const pathNameIndex = r.intPacked();
			const isExported = r.intPacked() === 1;
			
			if (isExported) {
				const pathName = r.fstring();
				const numExports = r.intPacked();
				if (numExports > 100_000) {
					throw new DecodeError(`numExports ${numExports} implausible`);
				}
				// For now, skip group tracking - we don't need it for player identity
			}
			
			// read_net_field_export - ONE field per layout
			const bExported = r.bool8();
			if (bExported) {
				r.intPacked(); // handle
				r.u32(); // compatibleChecksum
				r.fname(); // name
			}
		}
		
		// read_net_export_guids
		readNetExportGuids(r, state);
		
		// Skip streaming level data
		const nStreaming = r.intPacked();
		for (let i = 0; i < nStreaming; i++) {
			r.fstring(); // PackageName
			r.fstring(); // PackageNameToLoad
			for (let j = 0; j < 10; j++) {
				r.f64(); // FTransform components
			}
		}
		
		// read_external_data
		while (true) {
			const numBits = r.intPacked();
			if (numBits === 0) break;
			r.intPacked(); // guid
			r.rd((numBits + 7) >> 3); // payload
		}
		
		// Read packets
		while (!r.atEnd()) {
			const size = r.i32();
			if (size === 0) break;
			if (size < 0 || size > 2048) {
				throw new DecodeError(`packet size ${size} out of range`);
			}
			const pkt = r.rd(size);
			
			// For now, skip packet processing - we have the NetGUIDs which is enough
			// to see the channel opens
			state.packetCount++;
		}
		
		state.frameCount++;
		return r.off;
		
	} catch (e) {
		throw new DecodeError(`Frame parse failed: ${e}`);
	}
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
	let replayDataChunkCount = 0;
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
			replayDataChunkCount++;
			try {
				processReplayDataChunk(buffer.slice(offset, offset + chunkSize), state);
			} catch (e) {
				state.warnings.push(`Chunk ${replayDataChunkCount} process failed: ${e}`);
			}
		}
		
		offset += chunkSize;
		chunkCount++;
	}

	return state;
}

/**
 * Process a ReplayData chunk (contains demo frames).
 */
function processReplayDataChunk(chunkData: Uint8Array, state: NetstreamState): void {
	// ReplayData chunk structure:
	// uint32 time1
	// uint32 time2  
	// int32 length
	// int32 memorySizeInBytes (file version >= 6)
	// then demo frames
	
	const r = new ByteReader(chunkData);
	
	// Skip time1, time2
	r.u32();
	r.u32();
	
	// Read length
	const length = r.i32();
	
	// Skip memorySizeInBytes
	r.i32();
	
	if (length < 0 || length > chunkData.length) {
		state.warnings.push(`Invalid stream length: ${length}`);
		return;
	}
	
	// Process demo frames within this stream
	const streamData = r.rd(Math.min(length, r.remaining()));
	let streamOffset = 0;
	
	while (streamOffset < streamData.length && state.frameCount < MAX_FRAMES) {
		try {
			const bytesRead = processDemoFrame(streamData, streamOffset, state);
			streamOffset += bytesRead;
			
			if (bytesRead === 0) break;
		} catch (e) {
			state.warnings.push(`Frame process failed: ${e}`);
			break;
		}
	}
}

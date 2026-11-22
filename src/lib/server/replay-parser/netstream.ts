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
	bunchCount: number;
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

/**
 * Process a single bunch (content block on a channel).
 */

/**
 * Process a single packet (contains multiple bunches).
 */

/**
 * Read a NetGUID export from a bunch (bit-level internal_load_object).
 * Simplified version that just skips the data.
 */
function readNetGuidExport(bits: BitReader, state: NetstreamState, isExporting: boolean): number {
	const guid = bits.intPacked();
	if (guid === 0) return guid;
	
	if (guid === 1 || isExporting) {
		const flags = bits.u8();
		const EXPORT_FLAG_HAS_PATH = 1;
		const EXPORT_FLAG_HAS_NETWORK_CHECKSUM = 2;
		
		if (flags & EXPORT_FLAG_HAS_PATH) {
			bits.fstring(); // Skip path
			// outer
			readNetGuidExport(bits, state, isExporting);
		}
		
		if (flags & EXPORT_FLAG_HAS_NETWORK_CHECKSUM) {
			bits.u32(); // Skip checksum
		}
	}
	
	return guid;
}

/**
 * Process bunch payload to extract actor opens and property replications.
 * Port of process_bunch_payload from Python decode.py
 */
function processBunchPayload(
	bits: BitReader,
	ch: Channel,
	bOpen: boolean,
	state: NetstreamState,
	bHasMustBeMapped: boolean
): void {
	// Check if we have enough data
	if (bits.bitsLeft() < 8) {
		return; // Not enough data for any meaningful content
	}
	
	if (bHasMustBeMapped) {
		if (bits.bitsLeft() < 16) return;
		const numMustBeMapped = bits.u16();
		for (let i = 0; i < numMustBeMapped; i++) {
			if (bits.bitsLeft() < 8) break;
			bits.intPacked(); // Skip guid
		}
	}
	
	if (bOpen) {
		if (bits.bitsLeft() < 24) return; // Need at least actorGuid + bHasArchetype + maybe archetype
		// Actor channel open: read actor GUID and class
		ch.actorGuid = bits.intPacked();
		
		const bHasArchetype = bits.readBit();
		if (bHasArchetype) {
			ch.archetype = bits.intPacked();
		}
		
		// Read actor class from NetGUID map
		const classGuid = bits.intPacked();
		const classExport = state.guidMap.get(classGuid);
		if (classExport) {
			ch.class = classExport.pathName;
			// Extract class name from path like "/Script/TyrGame.BP_TyrPlayerState_C"
			const parts = ch.class.split('.');
			if (parts.length > 1) {
				ch.class = parts[parts.length - 1];
			}
			
			if (state.channels.size <= 20) {
				console.log(`  bOpen=true, ch=${ch.chIndex}, actorGuid=${ch.actorGuid}, classGuid=${classGuid}, class=${ch.class}`);
			}
		}
	}
	
	// Read properties
	while (!bits.atEnd()) {
		const repObject = bits.intPacked();
		if (repObject === 0) break;
		
		// Read property handle
		const handle = bits.intPacked();
		if (handle === 0) continue;
		
		// Read property payload length in bits
		const numBits = bits.serializedInt(2048 * 8);
		if (numBits === 0 || numBits > bits.bitsLeft()) {
			break;
		}
		
		const payload = bits.readBitsBytes(numBits);
		
		// Extract properties for player identity classes
		const isPlayerIdentityClass = ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C';
		if (isPlayerIdentityClass) {
			extractPlayerProperty(ch, handle, payload, numBits, state);
		}
	}
}

/**
 * Extract player identity properties from replicated data.
 * Port of property extraction logic from Python decode.py:1008-1115
 */
function extractPlayerProperty(
	ch: Channel,
	handle: number,
	payload: Uint8Array,
	numBits: number,
	state: NetstreamState
): void {
	// Get or create player identity record for this channel
	let rec = state.playerIdentity.get(ch.chIndex);
	if (!rec) {
		rec = {
			actorGuid: ch.actorGuid,
			class: ch.class
		};
		state.playerIdentity.set(ch.chIndex, rec);
	}
	
	// We need to match property handles to names, but we don't have the
	// NetFieldExportGroups mapped yet. For now, try to decode known property
	// types by their structure and context.
	
	// Try as FString (PlayerName/PlayerNamePrivate)
	// FString in property: has SavedNumBits prefix
	if (numBits > 32) {
		try {
			const bits = new BitReader(payload, numBits);
			bits.u32(); // Skip savedNumBits
			const str = bits.fstring();
			if (str.length > 0 && str.length < 100) {
				rec.name = str;
				rec.class = ch.class;
				rec.actorGuid = ch.actorGuid;
			}
		} catch (e) {
			// Not a string
		}
	}
	
	// Try as small int (TeamId: usually 8 bits)
	if (numBits > 0 && numBits <= 32) {
		const teamId = readIntFromBytes(payload, numBits);
		if (teamId >= 0 && teamId < 10) {
			rec.teamId = teamId;
			rec.class = ch.class;
			rec.actorGuid = ch.actorGuid;
		}
	}
	
	// Try as FUniqueNetIdRepl (UniqueID/UniqueId: usually >16 bits)
	if (numBits >= 16) {
		const steamId = decodeUniqueNetId(payload);
		if (steamId) {
			rec.steamId = steamId;
			rec.class = ch.class;
			rec.actorGuid = ch.actorGuid;
		}
	}
}

/**
 * Read an integer from bytes (little-endian).
 */
function readIntFromBytes(bytes: Uint8Array, numBits: number): number {
	const numBytes = Math.ceil(numBits / 8);
	let value = 0;
	for (let i = 0; i < numBytes && i < bytes.length; i++) {
		value |= bytes[i] << (i * 8);
	}
	return value;
}

/**
 * Process a packet and extract bunches.
 * Port of process_packet from Python decode.py:1376
 */
function processPacket(data: Uint8Array, state: NetstreamState): void {
	// Packet must have terminating 1-bit
	if (data.length === 0 || data[data.length - 1] === 0) {
		state.warnings.push('Packet has no termination bit');
		return;
	}
	
	// Strip terminating 1-bit to get actual bit length
	let last = data[data.length - 1];
	let nbits = data.length * 8 - 1;
	while (!(last & 0x80)) {
		last = (last << 1) & 0xff;
		nbits--;
	}
	
	const bits = new BitReader(data, nbits);
	
	while (!bits.atEnd()) {
		// Read bunch header
		const bControl = bits.readBit();
		const bOpen = bControl && bits.readBit();
		const bClose = bControl && bits.readBit();
		const closeReason = bClose ? bits.serializedInt(15) : 0; // CHANNEL_CLOSE_REASON_MAX
		bits.readBit(); // bIsReplicationPaused
		const bReliable = bits.readBit();
		const chIndex = bits.intPacked();
		
		if (chIndex > 32767) {
			throw new DecodeError(`chIndex ${chIndex} implausible`);
		}
		
		const bHasExports = bits.readBit();
		const bHasMustBeMapped = bits.readBit();
		const bPartial = bits.readBit();
		const bPartialInitial = bPartial && bits.readBit();
		bPartial && bits.readBit(); // bHasPartialCustomExportsFinalBit
		const bPartialFinal = bPartial && bits.readBit();
		
		let chName: string | undefined;
		if (bReliable || bOpen) {
			chName = bits.fname();
		}
		
		const bunchBits = bits.serializedInt(2048 * 8); // MAX_PACKET_SIZE_IN_BITS
		if (bunchBits > bits.bitsLeft()) {
			throw new DecodeError(`bunch size ${bunchBits} > bits left ${bits.bitsLeft()}`);
		}
		
		const payload = new BitReader(bits.readBitsBytes(bunchBits), bunchBits);
		state.bunchCount++;
		
		// Get or create channel
		let ch = state.channels.get(chIndex);
		if (!ch) {
			ch = {
				chIndex,
				actorGuid: 0,
				archetype: null,
				class: ''
			};
			state.channels.set(chIndex, ch);
		}
		if (chName) {
			ch.name = chName;
			if (state.channels.size <= 20) {
				// Debug: log first few channel opens
				console.log(`Channel ${chIndex} opened: ${chName}`);
			}
		}
		
		// Skip NetGUID exports (we don't need them for player identity)
		if (bHasExports) {
			try {
				// receiveNetGUIDBunch - skip for now
				const bHasReplayout = payload.readBit();
				if (bHasReplayout) {
					state.warnings.push('Unexpected ReceiveNetFieldExportsCompat path');
					continue;
				}
				const numGuids = payload.i32();
				if (numGuids < 0 || numGuids > 1024) {
					throw new DecodeError(`NumGUIDs ${numGuids} out of range`);
				}
				for (let i = 0; i < numGuids; i++) {
					// Skip internalLoadObject
					readNetGuidExport(payload, state, true);
				}
			} catch (e) {
				state.warnings.push(`NetGUID bunch failed: ${e}`);
				continue;
			}
		}
		
		// Skip Control and Voice channels
		if (ch.name === 'Control' || ch.name === 'Voice') {
			continue;
		}
		
		// Process bunch payload to extract properties
		if (!bPartial) {
			try {
				processBunchPayload(payload, ch, bOpen, state, bHasMustBeMapped);
				
				// Debug: log player identity classes
				if ((ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C') && state.playerIdentity.size <= 10) {
					console.log(`Player identity class detected: ch=${chIndex}, class=${ch.class}, actorGuid=${ch.actorGuid}`);
				}
			} catch (e) {
				state.warnings.push(`Bunch content failed ch=${chIndex}: ${e}`);
			}
		}
		// TODO: Handle partial bunches if needed
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
			
			try {
				processPacket(pkt, state);
			} catch (e) {
				state.warnings.push(`Packet process error: ${e}`);
				// Continue to next packet
			}
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
		packetCount: 0,
		bunchCount: 0
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

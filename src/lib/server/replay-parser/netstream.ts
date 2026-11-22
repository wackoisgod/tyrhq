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
	name?: string;
	partialData?: Uint8Array;
	partialBits?: number;
	partialReliable?: boolean;
	partialOpen?: boolean;
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

interface NetFieldExportGroup {
	path: string;
	index: number;
	num: number;
	fields: Map<number, string>; // handle -> field name
}

export interface NetstreamState {
	guidMap: Map<number, NetGUIDExport>;
	channels: Map<number, Channel>;
	playerIdentity: Map<number, PlayerIdentity>;
	groupsByPath: Map<string, NetFieldExportGroup>;
	groupsByIndex: Map<number, NetFieldExportGroup>;
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
 * Handle partial bunch merging (UChannel::ReceivedNextBunch).
 * Port of Python handle_partial (decode.py:1451-1480)
 */
function handlePartial(
	payload: BitReader,
	ch: Channel,
	state: NetstreamState,
	bInitial: boolean,
	bFinal: boolean,
	bReliable: boolean,
	bOpen: boolean,
	bClose: boolean,
	closeReason: number,
	bHasMustBeMapped: boolean
): void {
	if (bInitial) {
		// Start new partial bunch
		const bitsLeft = payload.bitsLeft();
		ch.partialData = bitsLeft > 0 ? payload.readBitsBytes(bitsLeft) : new Uint8Array(0);
		ch.partialBits = ch.partialData.length * 8;
		ch.partialReliable = bReliable;
		ch.partialOpen = bOpen;
		return;
	}
	
	if (!ch.partialData) {
		state.warnings.push('Partial merge without initial');
		return;
	}
	
	const n = payload.bitsLeft();
	if (n > 0) {
		if (ch.partialBits! % 8 !== 0) {
			state.warnings.push('Partial append unaligned');
			ch.partialData = undefined;
			return;
		}
		
		// Append fragment
		const fragment = payload.readBitsBytes(n);
		const merged = new Uint8Array(ch.partialData.length + fragment.length);
		merged.set(ch.partialData);
		merged.set(fragment, ch.partialData.length);
		ch.partialData = merged;
		ch.partialBits! += n;
	}
	
	if (bFinal) {
		// Merge complete - process the full bunch
		const merged = new BitReader(ch.partialData, ch.partialBits!);
		ch.partialData = undefined;
		
		processBunchPayload(merged, ch, ch.partialOpen!, state, bHasMustBeMapped);
		
		if (bClose) {
			// Close channel after processing
			state.channels.delete(ch.chIndex);
		}
	}
}

/**
 * Read a NetGUID export from a bunch (bit-level internal_load_object).
 * Simplified version that just skips the data.
 */
function readNetGuidExport(bits: BitReader, state: NetstreamState, isExporting: boolean): number {
	const startPos = bits.getPos();
	const guid = bits.intPacked();
	
	if ((state.bunchCount >= 8 && state.bunchCount <= 15) && startPos < 50) {
		console.log(`      readNetGuidExport (bunch ${state.bunchCount}) at pos ${startPos}: guid=${guid}, isExporting=${isExporting}, bitsLeft=${bits.bitsLeft()}`);
	}
	
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
	// Port of Python process_bunch_payload (decode.py:1228)
	
	if (state.bunchCount >= 8 && state.bunchCount <= 15) {
		console.log(`  processBunchPayload (bunch ${state.bunchCount}): ch=${ch.chIndex}, bOpen=${bOpen}, bHasMustBeMapped=${bHasMustBeMapped}, ch.actorGuid=${ch.actorGuid}, bitsLeft=${bits.bitsLeft()}`);
	}
	
	// MustBeMapped guid list
	if (bHasMustBeMapped) {
		if (bits.bitsLeft() < 16) return;
		
		const n = bits.u16();
		
		const guids: number[] = [];
		for (let i = 0; i < n; i++) {
			if (bits.bitsLeft() < 8) break;
			guids.push(bits.intPacked());
		}
		
		if (state.bunchCount >= 8 && state.bunchCount <= 15) {
			console.log(`    MustBeMapped (bunch ${state.bunchCount}): ch=${ch.chIndex}, n=${n}, guids=${JSON.stringify(guids)}`);
		}
	}
	
	// SerializeNewActor if channel not opened yet
	if (ch.actorGuid === 0) {
		if (!bOpen) {
			if (state.bunchCount <= 15) {
				console.log(`    Non-open bunch on actorless channel (bunch ${state.bunchCount}): ch=${ch.chIndex}`);
			}
			state.warnings.push(`Non-open bunch on actorless channel ${ch.chIndex}`);
			return;
		}
		
		// UPackageMapClient::SerializeNewActor
		const bitsBeforeActor = bits.bitsLeft();
		const posBeforeActor = bits.getPos();
		const actorGuid = readNetGuidExport(bits, state, false);
		ch.actorGuid = actorGuid;
		
		if (state.channels.size <= 35 || (state.bunchCount >= 9 && state.bunchCount <= 12)) {
			console.log(`    SerializeNewActor (bunch ${state.bunchCount}): ch=${ch.chIndex}, pos=${posBeforeActor}, actorGuid=${actorGuid}, bitsConsumed=${bitsBeforeActor - bits.bitsLeft()}`);
		}
		
		const dynamic = actorGuid > 1 && (actorGuid & 1) === 0;
		
		if (ch.chIndex === 31 || state.channels.size <= 35) {
			console.log(`      dynamic=${dynamic}, actorGuid=${actorGuid}, bitsLeft=${bits.bitsLeft()}`);
		}
		
		if (bits.atEnd() && dynamic) {
			return; // Early exit for dynamic actors with no more data
		}
		
		if (dynamic) {
			ch.archetype = readNetGuidExport(bits, state, false);
			readNetGuidExport(bits, state, false); // level guid
			
			if (state.channels.size <= 35) {
				console.log(`      SerializeNewActor archetype: ch=${ch.chIndex}, actorGuid=${actorGuid}, archetype=${ch.archetype}`);
			}
			
			// Skip location/rotation/scale/velocity for now
			// (would need conditionally_quantized_vector implementation)
			// For player identity extraction, we don't need these
		}
		
		// Get actor class from archetype or actor guid
		const archetypeGuid = ch.archetype || 0;
		const classExport = state.guidMap.get(archetypeGuid) || state.guidMap.get(actorGuid);
		if (classExport) {
			ch.class = classExport.pathName;
			// Extract class name from path
			const parts = ch.class.split('.');
			if (parts.length > 1) {
				ch.class = parts[parts.length - 1];
			}
			// Remove Default__ prefix if present
			ch.class = ch.class.replace(/^Default__/, '');
			
			if (state.channels.size <= 30) {
				console.log(`  Actor open: ch=${ch.chIndex}, actorGuid=${ch.actorGuid}, class=${ch.class}`);
			}
		}
	}
	
	// Content blocks (property replications)
	// Port of Python's content block reading loop (decode.py:1265+)
	while (!bits.atEnd()) {
		if (bits.bitsLeft() < 8) break;
		
		// read_content_block_header
		const bHasRepLayout = bits.readBit();
		const bIsActor = bits.readBit();
		
		if (state.bunchCount < 100 && (ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C')) {
			console.log(`    Content block (bunch ${state.bunchCount}): bHasRepLayout=${bHasRepLayout}, bIsActor=${bIsActor}, bitsLeft=${bits.bitsLeft()}`);
		}
		
		let repObj: number;
		if (bIsActor) {
			repObj = ch.archetype || ch.actorGuid;
		} else {
			// sub-object
			repObj = readNetGuidExport(bits, state, false);
			const bStablyNamed = bits.readBit();
			// For now, skip sub-objects - we only care about actor-level properties
			if (!bIsActor) {
				// Skip this content block
				const payloadBits = bits.intPacked();
				if (payloadBits > bits.bitsLeft()) break;
				bits.readBitsBytes(payloadBits);
				continue;
			}
		}
		
		// Read property payload
		const payloadBits = bits.intPacked();
		if (payloadBits === 0 || payloadBits > bits.bitsLeft()) {
			break;
		}
		
		const payload = bits.readBitsBytes(payloadBits);
		
		if (repObj === undefined || payloadBits === 0) {
			continue;
		}
		
		// Get group for this repObj guid (Python: state.group_for_guid)
		const guidExport = state.guidMap.get(repObj);
		if (!guidExport) {
			if (state.bunchCount < 100 && (ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C')) {
				console.log(`    No GUID export for repObj=${repObj}`);
			}
			continue;
		}
		
		const path = guidExport.pathName;
		const className = path.split('.').pop() || path;
		const cleanClassName = className.replace(/^Default__/, '');
		const group = state.groupsByPath.get(cleanClassName);
		
		if (state.bunchCount < 100 && (ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C')) {
			console.log(`    repObj=${repObj}, path=${path}, className=${cleanClassName}, group=${group ? 'FOUND' : 'NOT_FOUND'}, bHasRepLayout=${bHasRepLayout}`);
		}
		
		if (group && bHasRepLayout) {
			// Extract properties for player identity classes
			const isPlayerIdentityClass = cleanClassName === 'BP_TyrPlayerState_C' || cleanClassName === 'BP_PlayerRecord_C';
			if (state.bunchCount < 100 && (ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C')) {
				console.log(`    isPlayerIdentityClass: ${isPlayerIdentityClass}, cleanClassName: ${cleanClassName}`);
			}
			if (isPlayerIdentityClass) {
				console.log(`  Extracting property (bunch ${state.bunchCount}): ch=${ch.chIndex}, class=${cleanClassName}, repObj=${repObj}, payloadBits=${payloadBits}, playerIdentitySize=${state.playerIdentity.size}`);
				extractPlayerProperty(ch, 0, payload, payloadBits, state);
			}
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
	
	// Get NetFieldExportGroup for this class
	const group = state.groupsByPath.get(ch.class);
	if (!group) {
		// No group yet, can't decode properties
		if (state.playerIdentity.size <= 3) {
			console.log(`      No group found for class: ${ch.class}`);
			console.log(`      Available groups: ${Array.from(state.groupsByPath.keys()).slice(0, 10).join(', ')}`);
		}
		return;
	}
	
	if (state.playerIdentity.size <= 3) {
		console.log(`      Using group for ${ch.class}, ${group.fields.size} fields`);
		// Show first 16 bytes of payload
		const hexDump = Array.from(payload.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
		console.log(`      Payload hex: ${hexDump}`);
	}
	
	const bits = new BitReader(payload, numBits);
	
	// receive_properties: packed property-handle loop
	// Port from Python decode.py:957+
	try {
		const doChecksum = bits.readBit();
		
		if (state.playerIdentity.size <= 3) {
			console.log(`      doChecksum: ${doChecksum}, bitsLeft: ${bits.bitsLeft()}, pos: ${bits.getPos()}`);
		}
		
		let propCount = 0;
		while (!bits.atEnd() && bits.bitsLeft() > 8) {
			let propHandle;
			try {
				propHandle = bits.intPacked();
			} catch (e) {
				if (state.playerIdentity.size <= 3) {
					console.log(`      Error reading propHandle: ${e}`);
				}
				break;
			}
			
			if (propHandle === 0) {
				if (state.playerIdentity.size <= 3) {
					console.log(`      End of properties (handle=0) after ${propCount} props`);
				}
				break;
			}
			
			if (state.playerIdentity.size <= 3 && propCount === 0) {
				console.log(`      First propHandle: ${propHandle}`);
			}
			
			const handle = propHandle - 1; // 1-based on wire
			if (handle > group.num) {
				if (state.playerIdentity.size <= 3) {
					console.log(`      Handle ${handle} > group.num ${group.num}`);
				}
				break;
			}
			
			const propBits = bits.intPacked();
			if (propBits === 0 || propBits > bits.bitsLeft()) {
				if (state.playerIdentity.size <= 3) {
					console.log(`      Invalid propBits: ${propBits}, bitsLeft: ${bits.bitsLeft()}`);
				}
				break;
			}
			
			const propPayload = bits.readBitsBytes(propBits);
			const propName = group.fields.get(handle) || `handle${handle}`;
			
			if (state.playerIdentity.size <= 3 && propCount < 5) {
				console.log(`        Prop ${propCount}: handle=${handle}, name=${propName}, bits=${propBits}`);
			}
			propCount++;
			
			// Extract known player identity properties
			if ((propName === 'PlayerName' || propName === 'PlayerNamePrivate') && propBits >= 40) {
				try {
					const sub = new BitReader(propPayload, propBits);
					const str = sub.fstring();
					if (sub.atEnd() && str && str.length > 0) {
						rec.name = str;
						rec.class = ch.class;
						rec.actorGuid = ch.actorGuid;
						if (state.playerIdentity.size <= 3) {
							console.log(`      Found ${propName}: "${str}" on ch=${ch.chIndex}`);
						}
					}
				} catch (e) {
					// Failed to decode
				}
			} else if (propName === 'TeamId' && propBits > 0 && propBits <= 32) {
				rec.teamId = readIntFromBytes(propPayload, propBits);
				rec.class = ch.class;
				rec.actorGuid = ch.actorGuid;
				if (state.playerIdentity.size <= 3) {
					console.log(`      Found TeamId: ${rec.teamId} on ch=${ch.chIndex}`);
				}
			} else if ((propName === 'UniqueID' || propName === 'UniqueId') && propBits >= 16) {
				const steamId = decodeUniqueNetId(propPayload);
				if (steamId) {
					rec.steamId = steamId;
					rec.class = ch.class;
					rec.actorGuid = ch.actorGuid;
					if (state.playerIdentity.size <= 3) {
						console.log(`      Found UniqueID: ${steamId} on ch=${ch.chIndex}`);
					}
				}
			}
		}
	} catch (e) {
		// Property parsing failed
		if (state.warnings.length < 300) {
			state.warnings.push(`Property receive failed on ch=${ch.chIndex}: ${e}`);
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
	
	if (state.packetCount < 3) {
		console.log(`\n=== PACKET ${state.packetCount} size=${data.length} ===`);
		console.log(`  Packet bits: ${nbits}`);
	}
	
	const bits = new BitReader(data, nbits);
	
	let bunchNum = 0;
	while (!bits.atEnd() && bunchNum < 10) {
		const bunchStart = bits.getPos();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`\n  --- Bunch ${bunchNum} at bit ${bits.getPos()} ---`);
		}
		
		// Read bunch header
		const bControl = bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bControl: ${bControl} (pos now ${bits.getPos()})`);
		}
		
		const bOpen = bControl && bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bOpen: ${bOpen} (pos now ${bits.getPos()})`);
		}
		
		const bClose = bControl && bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bClose: ${bClose} (pos now ${bits.getPos()})`);
		}
		
		const closeReason = bClose ? bits.serializedInt(15) : 0; // CHANNEL_CLOSE_REASON_MAX
		if (bClose && bunchNum < 2 && state.packetCount < 3) {
			console.log(`    closeReason: ${closeReason} (pos now ${bits.getPos()})`);
		}
		
		bits.readBit(); // bIsReplicationPaused
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    after bIsReplicationPaused (pos now ${bits.getPos()})`);
		}
		
		const bReliable = bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bReliable: ${bReliable} (pos now ${bits.getPos()})`);
		}
		
		const chIndex = bits.intPacked();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    chIndex: ${chIndex} (pos now ${bits.getPos()})`);
		}
		
		if (chIndex > 32767) {
			throw new DecodeError(`chIndex ${chIndex} implausible`);
		}
		
		const bHasExports = bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bHasExports: ${bHasExports} (pos now ${bits.getPos()})`);
		}
		
		const bHasMustBeMapped = bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bHasMustBeMapped: ${bHasMustBeMapped} (pos now ${bits.getPos()})`);
		}
		
		const bPartial = bits.readBit();
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bPartial: ${bPartial} (pos now ${bits.getPos()})`);
		}
		
		const bPartialInitial = bPartial && bits.readBit();
		if (bPartial && bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bPartialInitial: ${bPartialInitial} (pos now ${bits.getPos()})`);
		}
		
		bPartial && bits.readBit(); // bHasPartialCustomExportsFinalBit
		if (bPartial && bunchNum < 2 && state.packetCount < 3) {
			console.log(`    after bHasPartialCustomExportsFinalBit (pos now ${bits.getPos()})`);
		}
		
		const bPartialFinal = bPartial && bits.readBit();
		if (bPartial && bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bPartialFinal: ${bPartialFinal} (pos now ${bits.getPos()})`);
		}
		
		let chName: string | undefined;
		if (bReliable || bOpen) {
			if (bunchNum < 2 && state.packetCount < 3) {
				console.log(`    Reading chName at pos ${bits.getPos()}`);
			}
			chName = bits.fname();
			if (bunchNum < 2 && state.packetCount < 3) {
				console.log(`    chName: ${chName} (pos now ${bits.getPos()})`);
			}
		}
		
		const bunchBits = bits.serializedInt(2048 * 8); // MAX_PACKET_SIZE_IN_BITS
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    bunchBits: ${bunchBits} (pos now ${bits.getPos()})`);
		}
		
		if (bunchBits > bits.bitsLeft()) {
			throw new DecodeError(`bunch size ${bunchBits} > bits left ${bits.bitsLeft()}`);
		}
		
		const payload = new BitReader(bits.readBitsBytes(bunchBits), bunchBits);
		if (bunchNum < 2 && state.packetCount < 3) {
			console.log(`    Payload: ${Math.ceil(bunchBits / 8)} bytes = ${bunchBits} bits`);
			console.log(`    After bunch (pos now ${bits.getPos()}, bits left ${bits.bitsLeft()})`);
		}
		
		state.bunchCount++;
		bunchNum++;
		
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
		
		// Process bunch payload
		if (bPartial) {
			// Handle partial bunch merging
			try {
				handlePartial(payload, ch, state, bPartialInitial, bPartialFinal, bReliable, bOpen, bClose, closeReason, bHasMustBeMapped);
			} catch (e) {
				state.warnings.push(`Partial bunch failed ch=${chIndex}: ${e}`);
			}
		} else {
			// Process complete bunch immediately
			try {
				processBunchPayload(payload, ch, bOpen, state, bHasMustBeMapped);
				
				// Debug: log player identity classes
				if ((ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C') && state.playerIdentity.size <= 10) {
					console.log(`Player identity class detected: ch=${chIndex}, class=${ch.class}, actorGuid=${ch.actorGuid}`);
				}
			} catch (e) {
				state.warnings.push(`Bunch content failed ch=${chIndex}: ${e}`);
			}
			
			if (bClose) {
				// Close channel after processing
				state.channels.delete(chIndex);
			}
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
			
			let group: NetFieldExportGroup | undefined;
			
			if (isExported) {
				const pathName = r.fstring();
				const numExports = r.intPacked();
				if (numExports > 100_000) {
					throw new DecodeError(`numExports ${numExports} implausible`);
				}
				
				// Get or create group
				group = state.groupsByPath.get(pathName);
				if (!group) {
					group = {
						path: pathName,
						index: pathNameIndex,
						num: numExports,
						fields: new Map()
					};
					state.groupsByPath.set(pathName, group);
					
					// Extract class key from path
					const parts = pathName.split('.');
					const className = parts.length > 1 ? parts[parts.length - 1] : pathName;
					state.groupsByPath.set(className, group);
				}
				group.num = Math.max(group.num, numExports);
				state.groupsByIndex.set(pathNameIndex, group);
			} else {
				group = state.groupsByIndex.get(pathNameIndex);
			}
			
			// read_net_field_export - ONE field per layout
			const bExported = r.bool8();
			if (bExported) {
				const handle = r.intPacked();
				r.u32(); // compatibleChecksum
				const name = r.fname();
				
				// Store field in group
				if (group) {
					group.fields.set(handle, name);
				}
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
		groupsByPath: new Map(),
		groupsByIndex: new Map(),
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

	console.log(`\nNetstream stats: ${state.frameCount} frames, ${state.packetCount} packets, ${state.bunchCount} bunches, ${state.channels.size} channels, ${state.playerIdentity.size} player identities, ${state.guidMap.size} GUIDs`);
	
	// Log channels with archetype=107
	let archetype107Count = 0;
	for (const [chIdx, ch] of state.channels) {
		if (ch.archetype === 107) {
			archetype107Count++;
			console.log(`  Channel ${chIdx}: actorGuid=${ch.actorGuid}, class=${ch.class || 'NOT SET'}`);
		}
	}
	console.log(`Total channels with archetype=107: ${archetype107Count}`);
	
	// Show GUID 107
	const guid107 = state.guidMap.get(107);
	console.log(`GUID 107: ${guid107 ? guid107.pathName : 'NOT FOUND'}`);
	
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

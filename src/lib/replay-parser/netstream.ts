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
	actorGuid: number | null;
	archetype: number | null;
	class: string;
	name?: string;
	partialData?: Uint8Array;
	partialBits?: number;
	partialReliable?: boolean;
	partialOpen?: boolean;
}

export interface PlayerIdentity {
	actorGuid: number | null;
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

export interface TeamInfoRec {
	teamId?: number;
	health: number[];
	maxHealth: number[];
}

/** Raw content-block tail captured for BP_TyrGameState_C (Python rpc_raw_blocks). */
export interface RpcRawBlock {
	nbits: number;
	raw: Uint8Array;
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
	/** class -> captured blocks, largest is the end-game scoreboard RPC */
	rpcRawBlocks: Map<string, RpcRawBlock[]>;
	teamInfo: Map<number, TeamInfoRec>;
	/** TeamWithLastStandId samples in arrival order; null means cleared */
	lastStandEvents: Array<number | null>;
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
function readNetGuidExport(bits: BitReader, state: NetstreamState, isExporting: boolean, depth = 0): number {
	if (depth > 16) {
		throw new DecodeError('InternalLoadObject recursion limit');
	}
	const guid = bits.intPacked();
	if (guid === 0) {
		return guid;
	}
	if (guid === 1 || isExporting) {
		const EXPORT_FLAG_HAS_PATH = 1;
		const EXPORT_FLAG_HAS_NETWORK_CHECKSUM = 4;
		const flags = bits.u8();
		if (flags & EXPORT_FLAG_HAS_PATH) {
			const outer = readNetGuidExport(bits, state, true, depth + 1);
			const path = bits.fstring();
			if (flags & EXPORT_FLAG_HAS_NETWORK_CHECKSUM) {
				bits.u32();
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
 * UPackageMapClient::SerializeNewActor helper (engineNetworkVersion >= 13).
 * Port of conditionally_quantized_vector from Python decode.py:1344-1371
 */
function conditionallyQuantizedVector(
	bits: BitReader,
	defaultVal: [number, number, number]
): [number, number, number] {
	if (!bits.readBit()) {
		return defaultVal;
	}
	if (bits.readBit()) {
		return bits.readPackedVector(10, 24);
	}
	return [bits.f64(), bits.f64(), bits.f64()];
}

/** Normalize object path to bare class name (Python class_key). */
function classKey(path: string): string {
	const key = path.split('.').pop() || path;
	return key.replace(/^Default__/, '');
}

/** Port of State.group_for_guid. */
function groupForGuid(state: NetstreamState, guid: number): NetFieldExportGroup | undefined {
	const exp = state.guidMap.get(guid);
	if (!exp) return undefined;
	return state.groupsByPath.get(classKey(exp.pathName));
}

/** Port of State.classnetcache_for_guid. */
function classNetCacheForGuid(state: NetstreamState, guid: number): NetFieldExportGroup | undefined {
	const path = state.guidMap.get(guid)?.pathName;
	if (!path) return undefined;
	const group = state.groupsByPath.get(classKey(path));
	if (!group) return undefined;
	return state.groupsByPath.get(classKey(group.path) + '_ClassNetCache');
}

const RPC_CAPTURE_CLASSES = new Set(['BP_TyrGameState_C']);
const RPC_CAPTURE_CAP = 50;

/**
 * UActorChannel::ReadContentBlockHeader (Python decode.py:1194-1225).
 */
function readContentBlockHeader(
	bits: BitReader,
	state: NetstreamState,
	ch: Channel
): [number | null, boolean, boolean] {
	const bHasRepLayout = bits.readBit();
	const bIsActor = bits.readBit();
	if (bIsActor) {
		return [ch.archetype ?? ch.actorGuid ?? null, bHasRepLayout, false];
	}
	const objGuid = readNetGuidExport(bits, state, false);
	const bStablyNamed = bits.readBit();
	if (bStablyNamed) {
		return [objGuid, bHasRepLayout, false];
	}
	let bDelete = false;
	let bSerializeClass = true;
	if (bits.readBit()) {
		bDelete = true;
		bSerializeClass = false;
		bits.u8();
	}
	let classGuid: number | null = null;
	if (bSerializeClass) {
		classGuid = readNetGuidExport(bits, state, false);
		bDelete = classGuid === 0;
	}
	if (bDelete) {
		return [null, bHasRepLayout, true];
	}
	const bActorIsOuter = bits.atEnd() || bits.readBit();
	if (!bActorIsOuter) {
		readNetGuidExport(bits, state, false);
	}
	return [classGuid, bHasRepLayout, false];
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
	if (bHasMustBeMapped) {
		const n = bits.u16();
		for (let i = 0; i < n; i++) {
			bits.intPacked();
		}
	}

	if (ch.actorGuid == null) {
		if (!bOpen) {
			state.warnings.push(`Non-open bunch on actorless channel ${ch.chIndex}`);
			return;
		}
		
		// UPackageMapClient::SerializeNewActor
		const actorGuid = readNetGuidExport(bits, state, false);
		ch.actorGuid = actorGuid;
		
		const dynamic = actorGuid > 1 && (actorGuid & 1) === 0;
		
		if (bits.atEnd() && dynamic) {
			return;
		}
		
		if (dynamic) {
			ch.archetype = readNetGuidExport(bits, state, false);
			readNetGuidExport(bits, state, false); // level guid
			conditionallyQuantizedVector(bits, [0, 0, 0]); // location
			if (bits.readBit()) {
				bits.readRotationShort();
			}
			conditionallyQuantizedVector(bits, [1, 1, 1]); // scale
			conditionallyQuantizedVector(bits, [0, 0, 0]); // velocity
		}

		// PlayerController channels carry one extra netPlayerIndex byte
		const archPath = ch.archetype ? state.guidMap.get(ch.archetype)?.pathName ?? '' : '';
		const akey = archPath.split('.').pop()?.replace(/^Default__/, '') ?? '';
		if ((akey.startsWith('PC_') || akey.includes('PlayerController')) && !bits.atEnd()) {
			bits.u8();
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
			}
		}
	}
	
	// Content blocks (property replications)
	// Port of Python's content block reading loop (decode.py:1267+)
	let blockNum = 0;
	while (!bits.atEnd()) {
		if (bits.bitsLeft() < 8) break;
		
		try {
			const [repObj, bHasRepLayout, bObjectDeleted] = readContentBlockHeader(bits, state, ch);
			if (bObjectDeleted) {
				continue;
			}
			const payloadBits = bits.intPacked();
			if (payloadBits > bits.bitsLeft()) {
				throw new DecodeError(`content-block payload ${payloadBits} > left ${bits.bitsLeft()}`);
			}
			const payload = bits.readBitsBytes(payloadBits);
			blockNum++;
			if (repObj == null || payloadBits === 0) {
				continue;
			}
			const group = groupForGuid(state, repObj);
			if (!group) {
				continue;
			}
			const sub = new BitReader(payload, payloadBits);
			if (bHasRepLayout) {
				try {
					receiveProperties(sub, group, state, ch);
				} catch {
					// Python: state.warn["receive_properties_failed"] += 1; continue
					continue;
				}
			}
			if (sub.atEnd()) {
				continue;
			}
			const cnc = classNetCacheForGuid(state, repObj);
			if (!cnc) {
				continue;
			}
			const cls = classKey(group.path);
			let fieldReader = sub;
			if (RPC_CAPTURE_CLASSES.has(cls) && !bHasRepLayout) {
				const left = fieldReader.bitsLeft();
				const raw = fieldReader.readBitsBytes(left);
				const blocks = state.rpcRawBlocks.get(cls) ?? [];
				if (blocks.length < RPC_CAPTURE_CAP) {
					blocks.push({ nbits: left, raw });
					state.rpcRawBlocks.set(cls, blocks);
				}
				fieldReader = new BitReader(raw, left);
			}
			try {
				while (!fieldReader.atEnd()) {
					fieldReader.serializedInt(Math.max(cnc.num + 1, 2));
					const fieldBits = fieldReader.intPacked();
					if (fieldBits > fieldReader.bitsLeft()) {
						throw new DecodeError('field payload too big');
					}
					fieldReader.readBitsBytes(fieldBits);
				}
			} catch {
				// Python: state.warn["classnetcache_fields_failed"] += 1
			}
		} catch (e) {
			if (e instanceof DecodeError) {
				break;
			}
			throw e;
		}
	}
}

/**
 * FRepLayout::ReceiveProperties -- packed property-handle loop.
 * Port of Python decode.py:957-1192 (receive_properties function).
 */
function receiveProperties(
	bits: BitReader,
	group: NetFieldExportGroup,
	state: NetstreamState,
	ch: Channel
): void {
	const cls = classKey(group.path);
	
	// doChecksum bit
	bits.readBit();
	
	// Property handle loop
	while (true) {
		if (bits.atEnd() || bits.bitsLeft() < 8) {
			break;
		}
		
		const handle = bits.intPacked();
		if (handle === 0) {
			break; // End of properties
		}
		
		const handleIdx = handle - 1; // 1-based on wire
		if (handleIdx > group.num) {
			throw new DecodeError(`handle ${handleIdx} > group size ${group.num}`);
		}
		
		const propBits = bits.intPacked();
		if (propBits > bits.bitsLeft()) {
			throw new DecodeError(`prop numBits ${propBits} > left ${bits.bitsLeft()}`);
		}
		
		const name = group.fields.get(handleIdx) || `handle${handleIdx}`;
		const propPayload = propBits > 0 ? bits.readBitsBytes(propBits) : new Uint8Array(0);
		
		// Now handle specific properties (port of Python lines 1001-1082)
		handleProperty(name, propPayload, propBits, cls, state, ch);
	}
}

/**
 * Handle individual property decoding.
 * Port of Python decode.py lines 1001-1082.
 */
function handleProperty(
	name: string,
	payload: Uint8Array,
	numBits: number,
	cls: string,
	state: NetstreamState,
	ch: Channel
): void {
	const isPlayerIdentityClass = cls === 'BP_TyrPlayerState_C' || cls === 'BP_PlayerRecord_C';
	
	// PlayerName / PlayerNamePrivate
	if ((name === 'PlayerName' || name === 'PlayerNamePrivate') && numBits >= 40 && isPlayerIdentityClass) {
		try {
			const sub = new BitReader(payload, numBits);
			const str = sub.fstring();
			if (sub.atEnd() && str && str.length > 0) {
				let rec = state.playerIdentity.get(ch.chIndex);
				if (!rec) {
					rec = { actorGuid: ch.actorGuid, class: cls };
					state.playerIdentity.set(ch.chIndex, rec);
				}
				rec.name = str;
				rec.class = cls;
				rec.actorGuid = ch.actorGuid;
			}
		} catch (e) {
			// Decode failed, skip
		}
	}
	// PlayerClan
	else if (name === 'PlayerClan' && numBits >= 40 && isPlayerIdentityClass) {
		try {
			const sub = new BitReader(payload, numBits);
			const str = sub.fstring();
			if (sub.atEnd() && str && str.length > 0) {
				let rec = state.playerIdentity.get(ch.chIndex);
				if (!rec) {
					rec = { actorGuid: ch.actorGuid, class: cls };
					state.playerIdentity.set(ch.chIndex, rec);
				}
				rec.clan = str;
			}
		} catch (e) {
			// Decode failed, skip
		}
	}
	// TeamId
	else if (name === 'TeamId' && isPlayerIdentityClass && numBits > 0 && numBits <= 32) {
		let rec = state.playerIdentity.get(ch.chIndex);
		if (!rec) {
			rec = { actorGuid: ch.actorGuid, class: cls };
			state.playerIdentity.set(ch.chIndex, rec);
		}
		rec.teamId = readIntFromBytes(payload, numBits);
		rec.class = cls;
		rec.actorGuid = ch.actorGuid;
	}
	else if (
		cls === 'TyrTeamPublicInfo' &&
		numBits === 32 &&
		(name === 'TeamId' || name === 'CurrentTeamHealth' || name === 'MaxTeamHealth') &&
		ch.actorGuid != null
	) {
		const v = readUintFromBytes(payload, numBits);
		let rec = state.teamInfo.get(ch.actorGuid);
		if (!rec) {
			rec = { health: [], maxHealth: [] };
			state.teamInfo.set(ch.actorGuid, rec);
		}
		if (name === 'TeamId') rec.teamId = v;
		else if (name === 'CurrentTeamHealth') rec.health.push(v);
		else rec.maxHealth.push(v);
	}
	else if (name === 'TeamWithLastStandId' && cls === 'BP_TyrGameState_C' && numBits > 0 && numBits <= 32) {
		const raw = readUintFromBytes(payload, numBits);
		state.lastStandEvents.push(raw === 0xffffffff ? null : raw);
	}
	// UniqueID (Steam ID)
	else if ((name === 'UniqueID' || name === 'UniqueId') && isPlayerIdentityClass && numBits >= 16) {
		const steamId = decodeUniqueNetId(payload);
		if (steamId) {
			let rec = state.playerIdentity.get(ch.chIndex);
			if (!rec) {
				rec = { actorGuid: ch.actorGuid, class: cls };
				state.playerIdentity.set(ch.chIndex, rec);
			}
			rec.steamId = steamId;
			rec.class = cls;
			rec.actorGuid = ch.actorGuid;
		}
	}
}

/**
 * Read an integer from bytes (little-endian).
 */
function readIntFromBytes(bytes: Uint8Array, numBits: number): number {
	return readUintFromBytes(bytes, numBits);
}

function readUintFromBytes(bytes: Uint8Array, numBits: number): number {
	const numBytes = Math.ceil(numBits / 8);
	let value = 0;
	for (let i = 0; i < numBytes && i < bytes.length; i++) {
		value += bytes[i] * 2 ** (i * 8);
	}
	if (numBits >= 32) return value >>> 0;
	return value & ((1 << numBits) - 1);
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
	
	let bunchNum = 0;
	while (!bits.atEnd() && bunchNum < 10) {
		const bunchStart = bits.getPos();
		
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
		
		const payloadBytes = bits.readBitsBytes(bunchBits);
		const payload = new BitReader(payloadBytes, bunchBits);
		
		if (state.bunchCount + 1 === 9) {
		}
		
		if (bunchNum < 2 && state.packetCount < 3) {
		}
		
		state.bunchCount++;
		bunchNum++;
		
		// Get or create channel
		let ch = state.channels.get(chIndex);
		if (!ch) {
			ch = {
				chIndex,
				actorGuid: null,
				archetype: null,
				class: ''
			};
			state.channels.set(chIndex, ch);
		}
		if (chName) {
			ch.name = chName;
			if (state.channels.size <= 20) {
				// Debug: log first few channel opens
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
			} catch {
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
			} catch {
				// Python: aborts partial path silently via warn counter
			}
		} else {
			// Process complete bunch immediately
			try {
				processBunchPayload(payload, ch, bOpen, state, bHasMustBeMapped);
				
				// Debug: log player identity classes
				if ((ch.class === 'BP_TyrPlayerState_C' || ch.class === 'BP_PlayerRecord_C') && state.playerIdentity.size <= 10) {
				}
			} catch {
				// Python: state.warn["bunch_content_failed"] += 1
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
					state.groupsByPath.set(classKey(pathName), group);
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
		
		state.packetCount++;  // Increment before processing to match Python
		
		try {
			processPacket(pkt, state);
			} catch {
				// Continue to next packet
			}
		}
		
		state.frameCount++;
		return r.offset();
		
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
	engineNetVersion: number,
	onProgress?: (fraction: number) => void
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
		bunchCount: 0,
		rpcRawBlocks: new Map(),
		teamInfo: new Map(),
		lastStandEvents: []
	};

	let offset = 0;
	let lastReported = -1;
	const report = (fraction: number) => {
		if (!onProgress || buffer.length === 0) return;
		const clamped = Math.max(0, Math.min(1, fraction));
		if (clamped < 1 && clamped - lastReported < 0.02) return;
		lastReported = clamped;
		onProgress(clamped);
	};
	
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
		report(offset / buffer.length);
	}
	report(1);

	
	// Log channels with archetype=107
	let archetype107Count = 0;
	for (const [chIdx, ch] of state.channels) {
		if (ch.archetype === 107) {
			archetype107Count++;
		}
	}
	
	// Show player identity records
	for (const [chIdx, identity] of state.playerIdentity) {
		if (identity.name || identity.steamId) {
		}
	}
	
	// Show GUID 107
	const guid107 = state.guidMap.get(107);
	
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

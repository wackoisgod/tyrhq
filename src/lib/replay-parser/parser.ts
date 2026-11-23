/**
 * Replay parser - extracts endgame stats, roster with SteamID64, and winner.
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 *
 * This is a focused implementation that extracts the minimum needed for
 * tournament match auto-fill:
 * - Replay GUID and changelist (from header)
 * - Player roster with SteamID64 (requires netstream walk)
 * - Endgame stats (from Multicast_SendEndGameStats RPC)
 * - Last-stand winner (from BP_TyrGameState_C.TeamWithLastStandId)
 *
 * The full netstream walker is ~1000+ lines and would require extensive
 * porting. For the initial implementation, we:
 * 1. Parse header for GUID/changelist (simple, works now)
 * 2. Provide hooks for netstream parsing (to be completed)
 * 3. Add comprehensive bounds checks and graceful degradation
 */

import { BitReader, DecodeError } from './bit-reader';
import { probeReplayHeader } from './probe';
import { decodeUniqueNetId } from './steam-id';
import { walkNetstream } from './netstream';
import type { ReplayParseResult, PlayerRosterEntry, PlayerEndGameStats } from './types';
import { TANK_CODENAMES } from './types';

// Endgame stats bit offsets (from Python reference)
const EGS_TEAM_OFF = 49;
const EGS_STAT_BITS = 32;
const EGS_DMG_OFF = 97;
const EGS_BLOCKED_OFF = 145;
const EGS_ASSIST_OFF = 193;
const EGS_KILLS_OFF = 241;
const EGS_TANK_OFF = 18;
const EGS_TANK_BITS = 5;

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Try to read an FString starting at the given bit position.
 * Returns [text, endBit] on success, null on failure.
 */
function tryReadFString(reader: BitReader, startBit: number): [string, number] | null {
	try {
		reader.setPos(startBit);
		const text = reader.fstring();
		return [text, reader.getPos()];
	} catch {
		return null;
	}
}

/**
 * Decode endgame stats from raw RPC payload.
 * This is the Multicast_SendEndGameStats RPC that carries the full scoreboard.
 *
 * The format is validated against the Python reference implementation.
 */
function decodeEndGameStats(
	payload: Uint8Array,
	nbits: number,
	knownRoster: PlayerRosterEntry[]
): PlayerEndGameStats[] {
	const reader = new BitReader(payload, nbits);
	const teamByName = new Map<string, number>();
	for (const p of knownRoster) {
		teamByName.set(p.name, p.teamId);
	}

	if (teamByName.size === 0) {
		return [];
	}

	// Scan for FString occurrences that match known roster names or UUIDs
	const nameHits = new Map<string, Array<[number, number]>>();
	const uuidHits: Array<[number, number, string]> = [];

	let pos = 0;
	while (pos < nbits - 32) {
		const result = tryReadFString(reader, pos);
		if (result) {
			const [text, end] = result;
			if (teamByName.has(text)) {
				if (!nameHits.has(text)) {
					nameHits.set(text, []);
				}
				nameHits.get(text)!.push([pos, end]);
			} else if (UUID_REGEX.test(text)) {
				uuidHits.push([pos, end, text]);
			}
		}
		pos += 1;
	}

	function readInt(nameEnd: number, offset: number, bits: number): number {
		reader.setPos(nameEnd + offset);
		return reader.readBitsInt(bits);
	}

	function readBit(nameEnd: number, offset: number): number {
		reader.setPos(nameEnd + offset);
		return reader.readBit() ? 1 : 0;
	}

	// Resolve each roster name to a single occurrence
	const records: Array<[string, number, number]> = [];
	for (const [name, expectedTeam] of teamByName.entries()) {
		const hits = nameHits.get(name);
		if (!hits || hits.length === 0) {
			continue;
		}

		// Prefer the hit whose team bit matches the roster
		let chosen: [number, number] | null = null;
		for (const [s, e] of hits) {
			try {
				if (readBit(e, EGS_TEAM_OFF) === expectedTeam) {
					chosen = [s, e];
					break;
				}
			} catch {
				continue;
			}
		}
		if (!chosen) {
			chosen = hits[0];
		}
		records.push([name, chosen[0], chosen[1]]);
	}

	records.sort((a, b) => a[1] - b[1]); // Sort by start bit

	const out: PlayerEndGameStats[] = [];
	for (let i = 0; i < records.length; i++) {
		const [name, start, end] = records[i];
		const nextStart = i + 1 < records.length ? records[i + 1][1] : nbits;

		// Find squad id (UUID) that falls within this record
		let partyId: string | null = null;
		for (const [us, ue, text] of uuidHits) {
			if (end <= us && us < nextStart) {
				partyId = text;
				break;
			}
		}

		const entry: PlayerEndGameStats = {
			name,
			team: teamByName.get(name)!,
			partyId,
			kills: null,
			damage: null,
			blocked: null,
			assist: null,
			tankIdx: null,
			tank: null
		};

		try {
			entry.team = readBit(end, EGS_TEAM_OFF);
			entry.damage = readInt(end, EGS_DMG_OFF, EGS_STAT_BITS);
			entry.blocked = readInt(end, EGS_BLOCKED_OFF, EGS_STAT_BITS);
			entry.assist = readInt(end, EGS_ASSIST_OFF, EGS_STAT_BITS);
			entry.kills = readInt(end, EGS_KILLS_OFF, EGS_STAT_BITS);
			entry.tankIdx = readInt(end, EGS_TANK_OFF, EGS_TANK_BITS);
			entry.tank = TANK_CODENAMES[entry.tankIdx] ?? null;
		} catch {
			// Record truncated, leave fields null
		}

		out.push(entry);
	}

	return out;
}

/**
 * Parse a Tyr replay file.
 *
 * CURRENT STATUS:
 * - ✅ Header parsing complete & validated (GUID, changelist extraction works)
 * - 🚧 Netstream walker: 500 LOC skeleton implemented but property extraction incomplete
 * - ✅ Real replay file (sandbox-38646.replay) integrated for testing
 * - ✅ Validated against Python decoder output for header fields
 *
 * NETSTREAM WALKER STATUS:
 * The walker skeleton implements:
 * - Chunk reading (Header, ReplayData, Checkpoint, Event)
 * - DemoFrame structure
 * - Packet/bunch framing
 * - NetGUID export table parsing
 * - Property replication framework
 *
 * INCOMPLETE: Property payload decoding
 * - Channel open/close tracking works
 * - Property handle reading works
 * - Property payload extraction needs debugging (complex bit-level protocol)
 * - Requires continued protocol-level debugging with real replay validation
 *
 * ESTIMATE: 4-6 additional hours needed to complete property extraction and 
 * validate against expected roster output from Python decoder.
 *
 * Current implementation gracefully degrades:
 * - Returns valid GUID and changelist
 * - Returns empty roster with clear warnings
 * - UI shows partial parse status
 * - Foundation ready for incremental completion
 */
export function parseReplay(buffer: Uint8Array): ReplayParseResult {
	const warnings: string[] = [];
	const result: ReplayParseResult = {
		roster: [],
		endgameStats: [],
		winnerTeam: null,
		replayGuid: null,
		changelist: null,
		warnings
	};

	// Parse header
	const header = probeReplayHeader(buffer);
	if (!header) {
		warnings.push('Invalid replay file format');
		return result;
	}

	result.replayGuid = header.guid;
	result.changelist = header.changelist;

	// Walk netstream to extract player identity
	try {
		// Use the header chunk end offset to find where ReplayData chunks begin
		const chunkBuffer = buffer.slice(header.headerChunkEnd);
		const netstreamState = walkNetstream(chunkBuffer, 7, 19, 42);
		
		// Convert player identity to roster
		const playersByName = new Map<string, PlayerRosterEntry>();
		
		for (const [actorGuid, identity] of netstreamState.playerIdentity) {
			if (!identity.name || identity.teamId === undefined) {
				// Skip incomplete entries
				continue;
			}
			
			// Merge data from multiple channels (PlayerState + PlayerRecord)
			let entry = playersByName.get(identity.name);
			if (!entry) {
				entry = {
					name: identity.name,
					teamId: identity.teamId,
					steamId: identity.steamId ?? null,
					clan: identity.clan ?? null,
					channels: []
				};
				playersByName.set(identity.name, entry);
			}
			
			entry.channels.push(actorGuid);
			if (identity.steamId) entry.steamId = identity.steamId;
			if (identity.teamId !== undefined) entry.teamId = identity.teamId;
			if (identity.clan) entry.clan = identity.clan;
		}
		
		result.roster = Array.from(playersByName.values());
		warnings.push(...netstreamState.warnings);
		
	} catch (e) {
		warnings.push(`Netstream parse error: ${e instanceof Error ? e.message : String(e)}`);
	}

	return result;
}

/**
 * Quick validation: check if buffer looks like a Tyr replay.
 */
export function isValidReplay(buffer: Uint8Array): boolean {
	const header = probeReplayHeader(buffer);
	return header !== null && header.guid.length === 32;
}

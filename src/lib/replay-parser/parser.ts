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
 * - Winner from team health pools, else the other side of the last stand
 */

import { BitReader, DecodeError } from './bit-reader';
import { probeReplayHeader } from './probe';
import { walkNetstream, type NetstreamState } from './netstream';
import type { ReplayParseResult, PlayerRosterEntry, PlayerEndGameStats } from './types';
import { TANK_CODENAMES } from './types';

export interface ReplayParseProgress {
	phase: 'header' | 'netstream' | 'scoreboard';
	/** Overall progress from 0 to 1. */
	fraction: number;
}

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
 * Port of _egs_try_fstring. Requires a plausible length and a NUL terminator.
 * Restores the reader position.
 */
function egsTryFString(reader: BitReader, pos: number): [string, number] | null {
	const nbits = reader.getPos() + reader.bitsLeft();
	if (pos + 32 > nbits) return null;
	const save = reader.getPos();
	try {
		reader.setPos(pos);
		const ln = reader.i32();
		if (ln === 0) return ['', reader.getPos()];
		if (ln > 0 && ln <= 256) {
			if (pos + 32 + ln * 8 > nbits) return null;
			const raw = reader.readBitsBytes(ln * 8);
			if (raw[ln - 1] !== 0) return null;
			const text = new TextDecoder('utf-8').decode(raw.subarray(0, ln - 1));
			return [text, reader.getPos()];
		}
		if (ln < 0 && ln >= -256) {
			const cnt = -ln;
			if (pos + 32 + cnt * 16 > nbits) return null;
			const raw = reader.readBitsBytes(cnt * 16);
			if (raw[cnt * 2 - 2] !== 0 || raw[cnt * 2 - 1] !== 0) return null;
			const text = new TextDecoder('utf-16le').decode(raw.subarray(0, cnt * 2 - 2));
			return [text, reader.getPos()];
		}
		return null;
	} catch {
		return null;
	} finally {
		reader.setPos(save);
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
		const result = egsTryFString(reader, pos);
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
 * Parse a Tyr replay file: header, roster, end-game scoreboard, and winner.
 */
export function parseReplay(
	buffer: Uint8Array,
	options?: { onProgress?: (progress: ReplayParseProgress) => void }
): ReplayParseResult {
	const warnings: string[] = [];
	const report = (phase: ReplayParseProgress['phase'], fraction: number) => {
		options?.onProgress?.({
			phase,
			fraction: Math.max(0, Math.min(1, fraction))
		});
	};
	const result: ReplayParseResult = {
		roster: [],
		endgameStats: [],
		winnerTeam: null,
		replayGuid: null,
		changelist: null,
		levelName: null,
		warnings
	};

	report('header', 0.02);

	// Parse header
	const header = probeReplayHeader(buffer);
	if (!header) {
		warnings.push('Invalid replay file format');
		report('header', 1);
		return result;
	}

	result.replayGuid = header.guid;
	result.changelist = header.changelist;
	result.levelName = header.levelName;
	report('header', 0.08);

	// Walk netstream to extract player identity
	try {
		// Use the header chunk end offset to find where ReplayData chunks begin
		const chunkBuffer = buffer.slice(header.headerChunkEnd);
		const netstreamState = walkNetstream(chunkBuffer, 7, 19, 42, (fraction) => {
			report('netstream', 0.08 + fraction * 0.84);
		});
		report('scoreboard', 0.94);
		
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
		const block = largestRpcBlock(netstreamState, 'BP_TyrGameState_C');
		if (block) {
			result.endgameStats = decodeEndGameStats(block.raw, block.nbits, result.roster);
		}
		result.winnerTeam = deriveWinnerTeam(netstreamState);
		warnings.push(...netstreamState.warnings);
		report('scoreboard', 1);
	} catch (e) {
		warnings.push(`Netstream parse error: ${e instanceof Error ? e.message : String(e)}`);
		report('scoreboard', 1);
	}

	return result;
}

function largestRpcBlock(
	state: NetstreamState,
	cls: string
): { nbits: number; raw: Uint8Array } | null {
	const blocks = state.rpcRawBlocks.get(cls);
	if (!blocks || blocks.length === 0) return null;
	return blocks.reduce((best, block) => (block.nbits > best.nbits ? block : best));
}

/** Port of derive_match_result, then derive_last_stand_winner when that is inconclusive. */
function deriveWinnerTeam(state: NetstreamState): number | null {
	const finals = new Map<number, number>();
	for (const rec of state.teamInfo.values()) {
		if (rec.teamId === undefined || rec.health.length === 0) continue;
		finals.set(rec.teamId, rec.health[rec.health.length - 1]);
	}
	if (finals.has(0) && finals.has(1)) {
		const dead = [0, 1].filter((team) => finals.get(team) === 0);
		if (dead.length === 1) return 1 - dead[0];
	}
	let last: number | null = null;
	for (const teamId of state.lastStandEvents) {
		if (teamId === 0 || teamId === 1) last = teamId;
	}
	if (last === null) return null;
	return 1 - last;
}

/**
 * Quick validation: check if buffer looks like a Tyr replay.
 */
export function isValidReplay(buffer: Uint8Array): boolean {
	const header = probeReplayHeader(buffer);
	return header !== null && header.guid.length === 32;
}

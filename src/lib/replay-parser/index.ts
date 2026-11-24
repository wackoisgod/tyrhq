/**
 * Tyr replay parser - browser-safe implementation.
 * 
 * Extracts header (GUID, changelist) and player roster (name, Steam ID, team, clan)
 * from Tyr replay files.
 * 
 * This module uses only browser-safe APIs:
 * - Uint8Array/DataView for binary parsing
 * - TextDecoder for string decoding
 * - No Node.js Buffer, fs, or other Node-specific APIs
 * 
 * The match page runs it in a Web Worker (`replay.worker.ts`) so the file
 * never leaves the browser.
 */

export { parseReplay, isValidReplay } from './parser';
export { probeReplayHeader } from './probe';
export type { ReplayParseProgress } from './parser';
export type {
	ReplayParseResult,
	PlayerRosterEntry,
	PlayerEndGameStats
} from './types';

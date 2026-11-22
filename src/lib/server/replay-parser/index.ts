/**
 * Tyr replay parser.
 *
 * Ported from tyr-replay-tools by legomaster188 (MIT License).
 * See LICENSE.md for full attribution.
 */

export { parseReplay, isValidReplay } from './parser';
export { codenameToVehicleKey, TANK_CODENAMES } from './types';
export type { ReplayParseResult, PlayerRosterEntry, PlayerEndGameStats } from './types';
export { DecodeError } from './bit-reader';

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseReplay } from './parser';

describe('Netstream Walker - Real Replay Validation', () => {
	it('extracts player identity from sandbox-38646.replay', () => {
		// Real Tyr replay provided by Andrew for validation
		// This is Andrew's own replay file, safe to commit
		const replayPath = '/cursor/stores/bc-62cc7906-af12-5698-8e6c-2ab6b920cb72/fixtures/sandbox-38646.replay';
		const buffer = new Uint8Array(readFileSync(replayPath));
		
		const result = parseReplay(buffer);
		
		console.log('Parse result:', {
			guid: result.replayGuid,
			changelist: result.changelist,
			rosterCount: result.roster.length,
			warningCount: result.warnings.length,
			firstWarning: result.warnings[0]
		});
		
		// Verify header extraction
		expect(result.replayGuid).toBe('89d31bb46e93b24b897a1749f392104a');
		expect(result.changelist).toBe(38646);
		
		// Expected roster from Python decoder:
		// - 1 real player: "wacko", team 0, Steam ID 76561197960747885, clan "Technotise"
		// - 9 bot entries: team 1, no names (just vehicle tags)
		
		// Find the real player
		const wacko = result.roster.find(p => p.name === 'wacko');
		expect(wacko).toBeDefined();
		expect(wacko?.teamId).toBe(0);
		expect(wacko?.steamId).toBe('76561197960747885');
		
		// Should have extracted at least one player
		expect(result.roster.length).toBeGreaterThan(0);
		
		// No endgame stats (sandbox didn't finish)
		expect(result.endgameStats).toEqual([]);
		expect(result.winnerTeam).toBeNull();
	});
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseReplay, isValidReplay } from './parser';
import { probeReplayHeader } from './probe';

describe('Replay Parser', () => {
	describe('isValidReplay', () => {
		it('rejects empty buffer', () => {
			expect(isValidReplay(new Uint8Array([]))).toBe(false);
		});

		it('rejects invalid magic', () => {
			const buffer = new Uint8Array(64);
			buffer[0] = 0x00;
			buffer[1] = 0x00;
			buffer[2] = 0x00;
			buffer[3] = 0x00;
			expect(isValidReplay(buffer)).toBe(false);
		});
	});

	describe('parseReplay', () => {
		it('returns empty result for invalid file', () => {
			const result = parseReplay(new Uint8Array([]));
			expect(result.replayGuid).toBeNull();
			expect(result.changelist).toBeNull();
			expect(result.warnings.length).toBeGreaterThan(0);
		});
	});

	describe('probeReplayHeader', () => {
		it('returns null for too-short buffer', () => {
			expect(probeReplayHeader(new Uint8Array(10))).toBeNull();
		});
	});

	describe('fixture replay', () => {
		it('matches expected.json for sandbox-38646.replay', () => {
			const replayPath = 'tests/fixtures/replay-parser/sandbox-38646.replay';
			const buffer = new Uint8Array(readFileSync(replayPath));
			const expected = JSON.parse(readFileSync('tests/fixtures/replay-parser/expected.json', 'utf-8'));

			const result = parseReplay(buffer);

			expect(result.warnings).toEqual([]);
			expect({
				header: { guid: result.replayGuid, changelist: result.changelist },
				roster: result.roster.map((e) => ({
					name: e.name,
					teamId: e.teamId,
					steamId: e.steamId,
					clan: e.clan
				}))
			}).toEqual(expected);
		});

		it('matches the Python scoreboard for ravine-40016-full.replay', () => {
			const buffer = new Uint8Array(
				readFileSync('tests/fixtures/replay-parser/ravine-40016-full.replay')
			);
			const expected = JSON.parse(
				readFileSync('tests/fixtures/replay-parser/ravine-40016-full.expected.json', 'utf-8')
			);
			const result = parseReplay(buffer);
			expect(result.warnings).toEqual([]);
			expect(result.winnerTeam).toEqual(expected.winnerTeam);
			expect(
				result.endgameStats.map((e) => ({
					name: e.name,
					team: e.team,
					tank: e.tank,
					tankIdx: e.tankIdx,
					kills: e.kills,
					damage: e.damage,
					blocked: e.blocked,
					assist: e.assist,
					partyId: e.partyId
				}))
			).toEqual(expected.endgameStats);
		}, 20_000);
	});
});

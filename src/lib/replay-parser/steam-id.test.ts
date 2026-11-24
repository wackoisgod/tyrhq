import { describe, it, expect } from 'vitest';
import { decodeUniqueNetId } from './steam-id';

describe('decodeUniqueNetId', () => {
	it('decodes valid Steam ID from packed BCD', () => {
		// Real example from Python reference:
		// 0x1d (flags: Encoded=1, type=3=Steam), 0x09 (size=9),
		// then 9 bytes of packed BCD for a 18-digit zero-padded number
		// Let's construct: 76561199123456789 (17 digits)
		// Padded to 18: 076561199123456789
		// Packed BCD: 07 65 61 19 91 23 45 67 89
		const data = new Uint8Array([
			0x1d, // flags
			0x09, // size
			0x07,
			0x65,
			0x61,
			0x19,
			0x91,
			0x23,
			0x45,
			0x67,
			0x89
		]);

		const result = decodeUniqueNetId(data);
		expect(result).toBe('76561199123456789');
	});

	it('returns null for empty payload', () => {
		expect(decodeUniqueNetId(new Uint8Array([]))).toBeNull();
	});

	it('returns null for too-short payload', () => {
		expect(decodeUniqueNetId(new Uint8Array([0x1d]))).toBeNull();
	});

	it('returns null when Encoded bit not set', () => {
		const data = new Uint8Array([0x00, 0x09]);
		expect(decodeUniqueNetId(data)).toBeNull();
	});

	it('returns null for zero size', () => {
		const data = new Uint8Array([0x1d, 0x00]);
		expect(decodeUniqueNetId(data)).toBeNull();
	});

	it('returns null for invalid BCD digits', () => {
		// Invalid nibble (0xFA has F > 9)
		const data = new Uint8Array([0x1d, 0x09, 0x07, 0x65, 0x61, 0x19, 0x91, 0x23, 0x45, 0x67, 0xfa]);
		expect(decodeUniqueNetId(data)).toBeNull();
	});

	it('returns null for non-Steam ID format', () => {
		// Valid BCD but wrong length (not 17 digits)
		// 12345678901234567 (17 digits but doesn't start with 7656119)
		const data = new Uint8Array([
			0x1d,
			0x09,
			0x01,
			0x23,
			0x45,
			0x67,
			0x89,
			0x01,
			0x23,
			0x45,
			0x67
		]);
		expect(decodeUniqueNetId(data)).toBeNull();
	});

	it('returns null for wrong prefix', () => {
		// Valid 17-digit number but wrong prefix
		// 86561199123456789
		const data = new Uint8Array([
			0x1d,
			0x09,
			0x08,
			0x65,
			0x61,
			0x19,
			0x91,
			0x23,
			0x45,
			0x67,
			0x89
		]);
		expect(decodeUniqueNetId(data)).toBeNull();
	});

	it('strips leading zeros correctly', () => {
		// 0076561199000000001 -> 76561199000000001
		// But we need to construct this so it has 17 digits after stripping
		// 76561199000000001 is 17 digits
		// Padded to 18: 076561199000000001
		// But wait - the prefix check requires starting with "7656119"
		// Let's use: 76561199123456780 (17 digits, starts with 7656119)
		// Padded: 076561199123456780
		const data = new Uint8Array([
			0x1d, // flags
			0x09, // size
			0x07, 0x65, 0x61, 0x19, 0x91, 0x23, 0x45, 0x67, 0x80
		]);
		const result = decodeUniqueNetId(data);
		expect(result).toBe('76561199123456780');
	});
});

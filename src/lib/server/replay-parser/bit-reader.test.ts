import { describe, it, expect } from 'vitest';
import { BitReader, DecodeError } from './bit-reader';

describe('BitReader', () => {
	describe('basic bit operations', () => {
		it('reads individual bits LSB-first', () => {
			// 0b10110010 = 0xB2 = 178
			const data = new Uint8Array([0xb2]);
			const reader = new BitReader(data);

			expect(reader.readBit()).toBe(false); // bit 0
			expect(reader.readBit()).toBe(true); // bit 1
			expect(reader.readBit()).toBe(false); // bit 2
			expect(reader.readBit()).toBe(false); // bit 3
			expect(reader.readBit()).toBe(true); // bit 4
			expect(reader.readBit()).toBe(true); // bit 5
			expect(reader.readBit()).toBe(false); // bit 6
			expect(reader.readBit()).toBe(true); // bit 7
		});

		it('reads multi-bit integers LSB-first', () => {
			const data = new Uint8Array([0xff, 0x0f]); // 0b00001111_11111111
			const reader = new BitReader(data);

			expect(reader.readBitsInt(4)).toBe(0x0f); // bits 0-3
			expect(reader.readBitsInt(8)).toBe(0xff); // bits 4-11
			expect(reader.readBitsInt(4)).toBe(0x00); // bits 12-15
		});

		it('tracks position correctly', () => {
			const data = new Uint8Array([0xff, 0xff]);
			const reader = new BitReader(data);

			expect(reader.getPos()).toBe(0);
			reader.readBitsInt(5);
			expect(reader.getPos()).toBe(5);
			reader.readBit();
			expect(reader.getPos()).toBe(6);
		});

		it('reports bits left correctly', () => {
			const data = new Uint8Array([0xff, 0xff]);
			const reader = new BitReader(data);

			expect(reader.bitsLeft()).toBe(16);
			reader.readBitsInt(5);
			expect(reader.bitsLeft()).toBe(11);
		});

		it('throws on read past end', () => {
			const data = new Uint8Array([0xff]);
			const reader = new BitReader(data);

			reader.readBitsInt(8);
			expect(() => reader.readBit()).toThrow(DecodeError);
		});
	});

	describe('integer types', () => {
		it('reads u8', () => {
			const data = new Uint8Array([0xab]);
			const reader = new BitReader(data);
			expect(reader.u8()).toBe(0xab);
		});

		it('reads u16 little-endian', () => {
			const data = new Uint8Array([0x34, 0x12]);
			const reader = new BitReader(data);
			expect(reader.u16()).toBe(0x1234);
		});

		it('reads u32 little-endian', () => {
			const data = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
			const reader = new BitReader(data);
			expect(reader.u32()).toBe(0x12345678);
		});

		it('reads i32 with sign extension', () => {
			const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
			const reader = new BitReader(data);
			expect(reader.i32()).toBe(-1);
		});
	});

	describe('floating point', () => {
		it('reads f32', () => {
			const buffer = new ArrayBuffer(4);
			const view = new DataView(buffer);
			view.setFloat32(0, 3.14, true); // little-endian
			const data = new Uint8Array(buffer);
			const reader = new BitReader(data);
			expect(reader.f32()).toBeCloseTo(3.14, 2);
		});

		it('reads f64', () => {
			const buffer = new ArrayBuffer(8);
			const view = new DataView(buffer);
			view.setFloat64(0, 2.718281828, true); // little-endian
			const data = new Uint8Array(buffer);
			const reader = new BitReader(data);
			expect(reader.f64()).toBeCloseTo(2.718281828, 9);
		});
	});

	describe('packed integers', () => {
		it('reads single-byte packed int', () => {
			// 0b01111110 = 0x7E = value 63 (bit 0 clear = no continuation)
			const data = new Uint8Array([0x7e]);
			const reader = new BitReader(data);
			expect(reader.intPacked()).toBe(63);
		});

		it('reads multi-byte packed int', () => {
			// Two bytes: 0xFF (127, continue), 0x02 (1, stop) = 127 + (1 << 7) = 255
			const data = new Uint8Array([0xff, 0x02]);
			const reader = new BitReader(data);
			expect(reader.intPacked()).toBe(255);
		});
	});

	describe('serialized int', () => {
		it('reads serialized int within max', () => {
			// For maxValue=10, we need 4 bits to represent 0-9
			// 0b1010 = 10, but maxValue is 10 so we stop at 9
			const data = new Uint8Array([0b00001010]);
			const reader = new BitReader(data);
			expect(reader.serializedInt(16)).toBeLessThan(16);
		});
	});

	describe('FString', () => {
		it('reads empty string', () => {
			const data = new Uint8Array([0, 0, 0, 0]);
			const reader = new BitReader(data);
			expect(reader.fstring()).toBe('');
		});

		it('reads UTF-8 string', () => {
			// Length 6 (positive), then "Hello\0"
			const data = new Uint8Array([6, 0, 0, 0, 72, 101, 108, 108, 111, 0]);
			const reader = new BitReader(data);
			expect(reader.fstring()).toBe('Hello');
		});

		it('throws on implausible length', () => {
			const data = new Uint8Array([0xff, 0xff, 0xff, 0x0f]); // Length > 100,000
			const reader = new BitReader(data);
			expect(() => reader.fstring()).toThrow(DecodeError);
		});
	});

	describe('bounds checking', () => {
		it('canRead returns false when insufficient bits', () => {
			const data = new Uint8Array([0xff]);
			const reader = new BitReader(data);
			expect(reader.canRead(8)).toBe(true);
			expect(reader.canRead(9)).toBe(false);
		});

		it('throws when reading beyond buffer', () => {
			const data = new Uint8Array([0xff]);
			const reader = new BitReader(data);
			expect(() => reader.readBitsInt(16)).toThrow(DecodeError);
		});
	});

	describe('position management', () => {
		it('setPos updates position', () => {
			const data = new Uint8Array([0xff, 0xff]);
			const reader = new BitReader(data);
			reader.setPos(10);
			expect(reader.getPos()).toBe(10);
		});

		it('atEnd detects end of stream', () => {
			const data = new Uint8Array([0xff]);
			const reader = new BitReader(data);
			expect(reader.atEnd()).toBe(false);
			reader.readBitsInt(8);
			expect(reader.atEnd()).toBe(true);
		});
	});
});

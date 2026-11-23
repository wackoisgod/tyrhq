/**
 * LSB-first bit archive reader (mirrors Unreal.Core BitReader).
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 *
 * Bit i of the stream is bit (i & 7) of byte (i >> 3) -- i.e. within each
 * byte the LEAST significant bit comes first.
 */

export class DecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecodeError';
	}
}

export class BitReader {
	private data: Uint8Array;
	private pos: number;
	private nbits: number;

	constructor(data: Uint8Array, nbits?: number) {
		this.data = data;
		this.pos = 0;
		this.nbits = nbits ?? data.length * 8;
	}

	atEnd(): boolean {
		return this.pos >= this.nbits;
	}

	bitsLeft(): number {
		return this.nbits - this.pos;
	}

	canRead(n: number): boolean {
		return this.pos + n <= this.nbits;
	}

	getPos(): number {
		return this.pos;
	}

	setPos(pos: number): void {
		this.pos = pos;
	}

	readBit(): boolean {
		if (this.pos >= this.nbits) {
			throw new DecodeError(`BitReader: read past end (pos ${this.pos}/${this.nbits})`);
		}
		const r = (this.data[this.pos >> 3] >> (this.pos & 7)) & 1;
		this.pos += 1;
		return r === 1;
	}

	/**
	 * Read n bits LSB-first into an integer (bit k of result = k-th bit read).
	 */
	readBitsInt(n: number): number {
		if (n === 0) {
			return 0;
		}
		if (n < 0 || !this.canRead(n)) {
			throw new DecodeError(`BitReader: want ${n} bits at pos ${this.pos}, have ${this.bitsLeft()}`);
		}
		if (n > 32) {
			throw new DecodeError(`BitReader: cannot read more than 32 bits at once, got ${n}`);
		}
		const start = this.pos;
		this.pos += n;
		const sb = start >> 3;
		const off = start & 7;
		const eb = (start + n + 7) >> 3;

		// A misaligned 32-bit read spans 5 bytes. JS << is 32-bit, so assemble with BigInt
		// (Python int.from_bytes).
		let val = 0n;
		for (let i = sb; i < eb && i < this.data.length; i++) {
			val |= BigInt(this.data[i]) << BigInt((i - sb) * 8);
		}
		val = (val >> BigInt(off)) & ((1n << BigInt(n)) - 1n);
		return Number(val);
	}

	readBitsBytes(n: number): Uint8Array {
		if (n === 0) return new Uint8Array(0);
		
		const byteCount = (n + 7) >> 3;
		
		// Python approach: read_bits_int(n) then convert to bytes
		// But readBitsInt only handles up to 32 bits, so we need to read the raw bytes directly
		const start = this.pos;
		this.pos += n;
		
		const sb = start >> 3; // start byte
		const off = start & 7; // bit offset within start byte
		const eb = (start + n + 7) >> 3; // end byte (ceil)
		
		// Extract bytes sb:eb
		const sourceBytes = this.data.slice(sb, eb);
		
		// Read as little-endian int (using BigInt to handle > 32 bits), shift right by offset, mask to n bits
		let val = 0n;
		for (let i = 0; i < sourceBytes.length; i++) {
			val |= BigInt(sourceBytes[i]) << BigInt(i * 8);
		}
		val = val >> BigInt(off);
		
		// Mask to n bits
		const mask = (1n << BigInt(n)) - 1n;
		val = val & mask;
		
		// Convert to bytes (little-endian)
		const bytes = new Uint8Array(byteCount);
		for (let i = 0; i < byteCount; i++) {
			bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
		}
		
		return bytes;
	}

	u8(): number {
		return this.readBitsInt(8);
	}

	u16(): number {
		return this.readBitsInt(16);
	}

	u32(): number {
		return this.readBitsInt(32);
	}

	i32(): number {
		const v = this.readBitsInt(32);
		return v & 0x80000000 ? v - 0x100000000 : v;
	}

	f32(): number {
		const bytes = this.readBitsBytes(32);
		const view = new DataView(bytes.buffer);
		return view.getFloat32(0, true); // true = little-endian
	}

	f64(): number {
		const bytes = this.readBitsBytes(64);
		const view = new DataView(bytes.buffer);
		return view.getFloat64(0, true); // true = little-endian
	}

	/**
	 * Bit-level FIntPacked: groups of 8 bits; bit0=continuation, bits1-7=value.
	 */
	intPacked(): number {
		const startPos = this.pos;
		let value = 0;
		for (let it = 0; it < 5; it++) {
			const b = this.readBitsInt(8);
			value |= (b >> 1) << (7 * it);
			
			// Debug for position 24
			if (startPos === 24 && it === 0) {
			}
			
			if (!(b & 1)) {
				break;
			}
		}
		return value;
	}

	/**
	 * Read FName (bit-level, UPackageMap::StaticSerializeName).
	 * Port of BitReader.fname from Python decode.py:369-375
	 */
	fname(): string {
		const bHardcoded = this.readBit();
		if (bHardcoded) {
			const idx = this.intPacked();
			return `HardcodedName_${idx}`;
		}
		const s = this.fstring();
		this.i32(); // InNumber
		return s;
	}

	/**
	 * FBitReader::SerializeInt: write as many bits as needed for max_value,
	 * LSB first, stopping once the next mask bit could exceed max_value-1.
	 */
	serializedInt(maxValue: number): number {
		let value = 0;
		let mask = 1;
		while (value + mask < maxValue) {
			if (this.readBit()) {
				value |= mask;
			}
			mask <<= 1;
		}
		return value;
	}

	/**
	 * Classic SerializePackedVector (NetSerialization.h).
	 * Port of BitReader.read_packed_vector from Python decode.py:397-409
	 */
	readPackedVector(scaleFactor: number, maxBits: number): [number, number, number] {
		const bits = this.serializedInt(maxBits);
		const bias = 1 << (bits + 1);
		const maxv = 1 << (bits + 2);
		const dx = this.serializedInt(maxv);
		const dy = this.serializedInt(maxv);
		const dz = this.serializedInt(maxv);
		return [
			(dx - bias) / scaleFactor,
			(dy - bias) / scaleFactor,
			(dz - bias) / scaleFactor
		];
	}

	/**
	 * Port of BitReader.read_rotation_short from Python decode.py:417-421
	 */
	readRotationShort(): [number, number, number] {
		const p = this.readBit() ? this.u16() * 360 / 65536 : 0;
		const y = this.readBit() ? this.u16() * 360 / 65536 : 0;
		const r = this.readBit() ? this.u16() * 360 / 65536 : 0;
		return [p, y, r];
	}

	/**
	 * Read FString from the bit stream.
	 */
	fstring(): string {
		const n = this.i32();
		if (n === 0) {
			return '';
		}
		if (n > 0) {
			if (n > 100_000) {
				throw new DecodeError(`BitReader: implausible FString len ${n} at pos ${this.pos}`);
			}
			// Read n bytes directly
			const bytes = new Uint8Array(n);
			for (let i = 0; i < n; i++) {
				bytes[i] = this.u8();
			}
			const decoder = new TextDecoder('utf-8', { fatal: false });
			return decoder.decode(bytes).replace(/\0+$/, '');
		}
		// UTF-16
		const absN = -n;
		if (absN > 100_000) {
			throw new DecodeError(`BitReader: implausible UTF16 FString len ${absN} at pos ${this.pos}`);
		}
		// Read absN * 2 bytes
		const bytes = new Uint8Array(absN * 2);
		for (let i = 0; i < absN * 2; i++) {
			bytes[i] = this.u8();
		}
		const decoder = new TextDecoder('utf-16le', { fatal: false });
		return decoder.decode(bytes).replace(/\0+$/, '');
	}
}

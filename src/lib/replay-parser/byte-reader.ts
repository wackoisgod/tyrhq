/**
 * Byte-level reader for replay structures (non-bit-aligned data).
 * 
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 */

import { DecodeError } from './bit-reader';

const MAX_STRING_LENGTH = 100_000;

export class ByteReader {
	private data: Uint8Array;
	private off: number;

	constructor(data: Uint8Array) {
		this.data = data;
		this.off = 0;
	}

	remaining(): number {
		return this.data.length - this.off;
	}

	atEnd(): boolean {
		return this.off >= this.data.length;
	}

	offset(): number {
		return this.off;
	}

	rd(n: number): Uint8Array {
		if (n < 0 || this.off + n > this.data.length) {
			throw new DecodeError(`ByteReader: want ${n} bytes at offset ${this.off}, have ${this.remaining()}`);
		}
		const result = this.data.slice(this.off, this.off + n);
		this.off += n;
		return result;
	}

	u8(): number {
		return this.rd(1)[0];
	}

	u16(): number {
		const bytes = this.rd(2);
		return bytes[0] | (bytes[1] << 8);
	}

	u32(): number {
		const bytes = this.rd(4);
		return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
	}

	i32(): number {
		const bytes = this.rd(4);
		let n = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
		return n >> 0; // Sign-extend if negative
	}

	i64(): bigint {
		const bytes = this.rd(8);
		let result = 0n;
		for (let i = 0; i < 8; i++) {
			result |= BigInt(bytes[i]) << BigInt(i * 8);
		}
		return result;
	}

	f32(): number {
		const bytes = this.rd(4);
		const view = new DataView(bytes.buffer, bytes.byteOffset);
		return view.getFloat32(0, true);
	}

	f64(): number {
		const bytes = this.rd(8);
		const view = new DataView(bytes.buffer, bytes.byteOffset);
		return view.getFloat64(0, true);
	}

	bool8(): boolean {
		return this.u8() !== 0;
	}

	intPacked(): number {
		let value = 0;
		for (let it = 0; it < 5; it++) {
			const b = this.u8();
			value |= (b >> 1) << (7 * it);
			if (!(b & 1)) {
				break;
			}
		}
		return value;
	}

	fstring(): string {
		const n = this.i32();
		if (n === 0) {
			return '';
		}
		if (n > 0) {
			if (n > MAX_STRING_LENGTH) {
				throw new DecodeError(`ByteReader: implausible FString len ${n}`);
			}
			const bytes = this.rd(n);
			const decoder = new TextDecoder('utf-8', { fatal: false });
			return decoder.decode(bytes).replace(/\0+$/, '');
		}
		const absN = -n;
		if (absN > MAX_STRING_LENGTH) {
			throw new DecodeError(`ByteReader: implausible UTF16 FString len ${absN}`);
		}
		const bytes = this.rd(absN * 2);
		const decoder = new TextDecoder('utf-16le', { fatal: false });
		return decoder.decode(bytes).replace(/\0+$/, '');
	}

	fname(): string {
		// Byte-aligned FName (engineNetworkVersion >= CHANNEL_NAMES path)
		// See ByteReader.fname in decode.py
		const bHardcoded = this.bool8();
		if (bHardcoded) {
			const idx = this.intPacked();
			// For now, just return a placeholder
			// Real implementation would lookup UNREAL_NAMES[idx]
			return `HardcodedName_${idx}`;
		}
		// Not hardcoded - read fstring + number
		const s = this.fstring();
		const n = this.u32();
		return n === 0 ? s : `${s}_${n}`;
	}
}

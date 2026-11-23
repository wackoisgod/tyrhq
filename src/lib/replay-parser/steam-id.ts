/**
 * Steam ID decoding from FUniqueNetIdRepl payloads.
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 */

/**
 * Decode an FUniqueNetIdRepl (BP_TyrPlayerState_C.UniqueID) property
 * payload to a canonical 17-digit SteamID64 decimal string, or null if it
 * isn't a decodable Steam id.
 *
 * Wire format (FUniqueNetIdRepl::NetSerialize "Encoded" path):
 *   byte 0:  EncodingFlags: bit0 Encoded, bit1 EmptyId, bit2 IsPadded;
 *            upper 5 bits (>>3) are the OSS type-hash index (== 3, Steam).
 *   byte 1:  EncodedSize: count of following data bytes (9 => 18-digit,
 *            zero-padded SteamID64).
 *   bytes 2+: EncodedSize bytes of packed BCD -- each byte is two decimal
 *            digits, high nibble first (0x76 -> "76"). Concatenate, strip
 *            the pad/leading zero, and that's the decimal id.
 *
 * Returns the SteamID64 string, or null on any malformed field (empty id,
 * non-BCD nibble, short buffer, out-of-range result).
 */
export function decodeUniqueNetId(payload: Uint8Array): string | null {
	if (!payload || payload.length < 2) {
		return null;
	}

	const flags = payload[0];
	if (!(flags & 0x01)) {
		// Not Encoded / EmptyId -> not our path
		return null;
	}

	const size = payload[1];
	if (size === 0 || payload.length < 2 + size) {
		return null;
	}

	const digits: string[] = [];
	for (let i = 0; i < size; i++) {
		const b = payload[2 + i];
		const hi = b >> 4;
		const lo = b & 0x0f;
		if (hi > 9 || lo > 9) {
			// Not valid packed BCD -> reject
			return null;
		}
		digits.push(String(hi));
		digits.push(String(lo));
	}

	const dec = digits.join('').replace(/^0+/, '');

	// SteamID64 individual-account universe: 76561197xxxxxxxxx..76561199xxxxxxxxx
	if (dec.length !== 17 || !dec.startsWith('7656119')) {
		return null;
	}

	return dec;
}

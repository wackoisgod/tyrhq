/**
 * RFC 6749 §2.3.1: HTTP Basic credentials are form-urlencoded, then base64.
 * Split on the first colon only so a secret may contain colons, then
 * decode each part (application/x-www-form-urlencoded: '+' is a space).
 *
 * Lives outside the token route because SvelteKit only allows HTTP method
 * handlers (and `_`-prefixed names) to be exported from `+server.ts`.
 */
export function decodeBasicClientCredentials(
	authHeader: string
): { clientId: string; clientSecret: string } | null {
	if (!authHeader.startsWith('Basic ')) return null;

	const decoded = Buffer.from(authHeader.slice('Basic '.length).trim(), 'base64').toString('utf8');
	const separator = decoded.indexOf(':');
	if (separator < 0) return null;

	const decodePart = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
	try {
		return {
			clientId: decodePart(decoded.slice(0, separator)),
			clientSecret: decodePart(decoded.slice(separator + 1))
		};
	} catch {
		return null;
	}
}

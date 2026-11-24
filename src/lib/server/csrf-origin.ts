import { json, text } from '@sveltejs/kit';

/**
 * Content types SvelteKit 2.58 treats as form submissions in
 * `is_form_content_type`. `application/x-sveltekit-formdata` is the
 * progressive-enhancement form action type, included so this check
 * stays aligned with the built-in one.
 */
const FORM_CONTENT_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
]);

const CHECKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Supabase exchanges the Steam authorization code with a server-to-server
 * form POST and no Origin header. The route authenticates with client_secret.
 */
export const STEAM_OIDC_TOKEN_PATH = '/auth/steam/oidc/token';

function isFormContentType(request: Request) {
	const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return FORM_CONTENT_TYPES.has(type);
}

/**
 * Replacement for SvelteKit's origin check (`kit.csrf.checkOrigin`), which
 * is disabled because a missing Origin cannot be allow-listed with
 * `trustedOrigins`. With no trusted origins configured, a form POST, PUT,
 * PATCH, or DELETE is rejected when `Origin` is not `url.origin`.
 * `POST /auth/steam/oidc/token` is the only exemption.
 */
export function crossSiteFormRejection(request: Request, url: URL): Response | null {
	if (request.method === 'POST' && url.pathname === STEAM_OIDC_TOKEN_PATH) {
		return null;
	}

	if (!CHECKED_METHODS.has(request.method) || !isFormContentType(request)) {
		return null;
	}

	const requestOrigin = request.headers.get('origin');
	if (requestOrigin === url.origin) return null;

	const message = `Cross-site ${request.method} form submissions are forbidden`;
	if (request.headers.get('accept') === 'application/json') {
		return json({ message }, { status: 403 });
	}
	return text(message, { status: 403 });
}

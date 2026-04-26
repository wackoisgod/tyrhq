import { env } from '$env/dynamic/public';

function normalizeOrigin(origin: string | null | undefined) {
	if (!origin) return null;

	try {
		const url = new URL(origin);
		url.pathname = '/';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/, '');
	} catch {
		return null;
	}
}

export function getConfiguredSiteOrigin() {
	return normalizeOrigin(env.PUBLIC_SITE_URL);
}

export function getAbsoluteUrl(path: string, fallbackOrigin?: string | null) {
	const baseOrigin = getConfiguredSiteOrigin() ?? normalizeOrigin(fallbackOrigin);
	if (!baseOrigin) return path;
	return new URL(path, `${baseOrigin}/`).toString();
}

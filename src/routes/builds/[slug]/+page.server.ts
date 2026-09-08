import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Share links use this short URL. Full-page loads are redirected at the
// Vercel proxy (see vercel.json) without invoking a function; this route
// remains as the fallback for client-side navigation and other hosts.
export const load: PageServerLoad = async ({ params }) => {
	redirect(303, `/tools/builds?slug=${params.slug}`);
};

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

let adminClient: SupabaseClient | null | undefined;

export function isSupabaseAdminConfigured() {
	return Boolean(publicEnv.PUBLIC_SUPABASE_URL && privateEnv.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdminClient() {
	if (!isSupabaseAdminConfigured()) {
		return null;
	}

	if (adminClient !== undefined) {
		return adminClient;
	}

	adminClient = createClient(
		publicEnv.PUBLIC_SUPABASE_URL!,
		privateEnv.SUPABASE_SERVICE_ROLE_KEY!,
		{
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		}
	);

	return adminClient;
}

export async function loadProfile(locals: App.Locals, userId: string) {
	let { data: profile, error } = await locals.supabase
		.from('profiles')
		.select('display_name, is_tournament_organizer, discord_handle, steam_profile, verified_steam_id, steam_display_name, steam_verified_at')
		.eq('id', userId)
		.single();

	if (error?.message?.includes('is_tournament_organizer') || error?.message?.includes('discord_handle') || error?.message?.includes('steam_profile') || error?.message?.includes('verified_steam_id')) {
		const fallback = await locals.supabase
			.from('profiles')
			.select('display_name')
			.eq('id', userId)
			.single<{ display_name: string }>();
		profile = fallback.data ? { ...fallback.data, is_tournament_organizer: false, discord_handle: null, steam_profile: null, verified_steam_id: null, steam_display_name: null, steam_verified_at: null } : null;
	}

	if (!profile) {
		await locals.supabase
			.from('profiles')
			.insert({ id: userId, display_name: '' });
		profile = { display_name: '', is_tournament_organizer: false, discord_handle: null, steam_profile: null, verified_steam_id: null, steam_display_name: null, steam_verified_at: null };
	}

	return profile;
}

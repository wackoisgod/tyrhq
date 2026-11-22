export async function loadProfile(locals: App.Locals, userId: string) {
	let { data: profile, error } = await locals.supabase
		.from('profiles')
		.select('display_name, is_tournament_organizer, discord_handle, steam_profile')
		.eq('id', userId)
		.single();

	if (error?.message?.includes('is_tournament_organizer') || error?.message?.includes('discord_handle') || error?.message?.includes('steam_profile')) {
		const fallback = await locals.supabase
			.from('profiles')
			.select('display_name')
			.eq('id', userId)
			.single<{ display_name: string }>();
		profile = fallback.data ? { ...fallback.data, is_tournament_organizer: false, discord_handle: null, steam_profile: null } : null;
	}

	if (!profile) {
		await locals.supabase
			.from('profiles')
			.insert({ id: userId, display_name: '' });
		profile = { display_name: '', is_tournament_organizer: false, discord_handle: null, steam_profile: null };
	}

	return profile;
}

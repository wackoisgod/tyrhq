export async function loadProfile(locals: App.Locals, userId: string) {
	let { data: profile } = await locals.supabase
		.from('profiles')
		.select('display_name')
		.eq('id', userId)
		.single();

	if (!profile) {
		await locals.supabase
			.from('profiles')
			.insert({ id: userId, display_name: '' });
		profile = { display_name: '' };
	}

	return profile;
}

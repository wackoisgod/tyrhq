<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	type AdminUser = {
		id: string;
		email: string | null;
		displayName: string;
		role: 'user' | 'contributor' | 'admin';
		createdAt: string;
		lastSignInAt: string | null;
	};

	const ROLE_BADGE: Record<string, string> = {
		admin: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]',
		contributor: 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]',
		user: 'bg-[var(--hud-inset)] text-[var(--hud-muted)]'
	};

	let busyId = $state<string | null>(null);
	let actionError = $state('');

	let searchQuery = $state('');
	let searchResults = $state<AdminUser[] | null>(null);
	let searching = $state(false);
	let searchError = $state('');
	let searchInfo = $state('');
	let lastSearchAt = 0;

	async function setRole(id: string, role: 'user' | 'contributor' | 'admin') {
		if (busyId) return;
		busyId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/users/${id}/role`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ role })
			});
			if (!res.ok) {
				actionError = await res.text();
				return;
			}
			// Reload elevated list AND refresh any current search results
			await invalidateAll();
			if (searchQuery.trim().length >= 3) await runSearch();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Role update failed.';
		} finally {
			busyId = null;
		}
	}

	async function runSearch() {
		const q = searchQuery.trim();
		if (q.length < 3) {
			searchError = 'Search must be at least 3 characters.';
			searchResults = null;
			searchInfo = '';
			return;
		}
		const issuedAt = Date.now();
		lastSearchAt = issuedAt;
		searching = true;
		searchError = '';
		searchInfo = '';
		try {
			const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
			if (lastSearchAt !== issuedAt) return;
			if (!res.ok) {
				searchError = await res.text();
				searchResults = null;
				return;
			}
			const data = await res.json();
			searchResults = data.users as AdminUser[];
			if (searchResults.length === 0) {
				searchInfo = 'No matches.';
			} else if (searchResults.length === 20) {
				searchInfo = 'Showing the first 20 matches — refine your query for more.';
			}
		} catch (err) {
			if (lastSearchAt !== issuedAt) return;
			searchError = err instanceof Error ? err.message : 'Search failed.';
			searchResults = null;
		} finally {
			if (lastSearchAt === issuedAt) searching = false;
		}
	}

	function onSearchSubmit(e: SubmitEvent) {
		e.preventDefault();
		runSearch();
	}

	function clearSearch() {
		searchQuery = '';
		searchResults = null;
		searchError = '';
		searchInfo = '';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString();
	}

	function isElevated(role: string) {
		return role === 'contributor' || role === 'admin';
	}
</script>

<svelte:head>
	<title>Tyr HQ | User roles</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Admin
	</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		User roles
	</h1>
	<p class="mt-3 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
		<strong class="text-[var(--hud-text)]">User</strong> can read everything and submit
		drafts. <strong class="text-[var(--hud-text)]">Reviewer</strong> can additionally approve
		submissions and withdraw / restore articles.
		<strong class="text-[var(--hud-text)]">Admin</strong> can additionally manage roles and is
		exempt from the no-self-approval rule.
	</p>

	{#if actionError}
		<p class="mt-6 rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]">
			{actionError}
		</p>
	{/if}

	<!-- Reviewers + admins -->
	<div class="mt-8">
		<h2
			class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			Reviewers and admins ({data.elevated.length})
		</h2>
		<div
			class="mt-3 overflow-hidden rounded-sm bg-[var(--hud-panel)]"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			{#if data.elevated.length === 0}
				<p class="p-6 text-sm text-[var(--hud-muted)]">
					No reviewers or admins yet besides you. Use the search below to find users to promote.
				</p>
			{:else}
				<table class="w-full text-left text-sm">
					<thead>
						<tr
							class="border-b border-[var(--hud-variant)] text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							<th class="px-4 py-3">User</th>
							<th class="px-4 py-3">Email</th>
							<th class="px-4 py-3">Role</th>
							<th class="px-4 py-3">Last sign in</th>
							<th class="px-4 py-3 text-right">Change</th>
						</tr>
					</thead>
					<tbody>
						{#each data.elevated as u}
							{@const isSelf = u.id === data.currentUserId}
							<tr class="border-b border-[var(--hud-variant)]/50 align-middle">
								<td class="px-4 py-3 text-[var(--hud-text)]">
									{u.displayName || '(no callsign)'}
									{#if isSelf}
										<span class="ml-1 text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
											(you)
										</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-xs text-[var(--hud-muted)]">{u.email ?? '—'}</td>
								<td class="px-4 py-3">
									<span
										class="inline-block rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {ROLE_BADGE[u.role]}"
									>
										{u.role}
									</span>
								</td>
								<td class="px-4 py-3 text-xs text-[var(--hud-dim)]">
									{formatDate(u.lastSignInAt)}
								</td>
								<td class="px-4 py-3 text-right">
									<select
										value={u.role}
										disabled={busyId === u.id}
										onchange={(e) =>
											setRole(
												u.id,
												e.currentTarget.value as 'user' | 'contributor' | 'admin'
											)}
										class="rounded-sm bg-[var(--hud-inset)] px-2 py-1 text-xs text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)] disabled:opacity-50"
									>
										<option value="user">User</option>
										<option value="contributor">Reviewer</option>
										<option value="admin">Admin</option>
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</div>

	<!-- Search -->
	<div class="mt-10">
		<h2
			class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			Find a user to promote
		</h2>
		<p class="mt-2 max-w-2xl text-xs text-[var(--hud-muted)]">
			Search by email or callsign (3+ characters). Results are limited to 20 — refine your query
			if you don't see what you need.
		</p>

		<form
			onsubmit={onSearchSubmit}
			class="mt-3 flex flex-wrap items-center gap-2"
		>
			<input
				type="search"
				bind:value={searchQuery}
				placeholder="email or callsign…"
				autocomplete="off"
				class="min-w-[260px] flex-1 rounded-sm bg-[var(--hud-inset)] px-3 py-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
			/>
			<button
				type="submit"
				disabled={searching || searchQuery.trim().length < 3}
				class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
			>
				{searching ? 'Searching…' : 'Search'}
			</button>
			{#if searchResults !== null}
				<button
					type="button"
					onclick={clearSearch}
					class="hud-cta-ghost px-3 py-2 text-xs"
				>
					Clear
				</button>
			{/if}
		</form>

		{#if searchError}
			<p
				class="mt-3 rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]"
			>
				{searchError}
			</p>
		{/if}

		{#if searchInfo && !searchError}
			<p class="mt-3 text-xs text-[var(--hud-dim)]">{searchInfo}</p>
		{/if}

		{#if searchResults && searchResults.length > 0}
			<div
				class="mt-3 overflow-hidden rounded-sm bg-[var(--hud-panel)]"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				<table class="w-full text-left text-sm">
					<thead>
						<tr
							class="border-b border-[var(--hud-variant)] text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
						>
							<th class="px-4 py-3">User</th>
							<th class="px-4 py-3">Email</th>
							<th class="px-4 py-3">Role</th>
							<th class="px-4 py-3 text-right">Change</th>
						</tr>
					</thead>
					<tbody>
						{#each searchResults as u}
							{@const isSelf = u.id === data.currentUserId}
							<tr class="border-b border-[var(--hud-variant)]/50 align-middle">
								<td class="px-4 py-3 text-[var(--hud-text)]">
									{u.displayName || '(no callsign)'}
									{#if isSelf}
										<span class="ml-1 text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
											(you)
										</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-xs text-[var(--hud-muted)]">{u.email ?? '—'}</td>
								<td class="px-4 py-3">
									<span
										class="inline-block rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {ROLE_BADGE[u.role]}"
									>
										{u.role}
									</span>
								</td>
								<td class="px-4 py-3 text-right">
									<select
										value={u.role}
										disabled={busyId === u.id}
										onchange={(e) =>
											setRole(
												u.id,
												e.currentTarget.value as 'user' | 'contributor' | 'admin'
											)}
										class="rounded-sm bg-[var(--hud-inset)] px-2 py-1 text-xs text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)] disabled:opacity-50"
									>
										<option value="user">User</option>
										<option value="contributor">Reviewer</option>
										<option value="admin">Admin</option>
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>

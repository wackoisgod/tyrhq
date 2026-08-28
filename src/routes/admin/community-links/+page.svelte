<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	type Link = {
		id: string;
		group_id: string;
		label: string;
		href: string;
		description: string | null;
		tag: string | null;
	};
	type Group = {
		id: string;
		heading: string;
		annotation: string | null;
		links: Link[];
	};

	type LinkDraft = { label: string; href: string; description: string; tag: string };
	type GroupDraft = { heading: string; annotation: string };

	const emptyLinkDraft = (): LinkDraft => ({ label: '', href: '', description: '', tag: '' });

	let busy = $state(false);
	let actionError = $state('');

	// Which row is open in edit mode, keyed by id. Only one at a time.
	let editingGroupId = $state<string | null>(null);
	let groupDraft = $state<GroupDraft>({ heading: '', annotation: '' });

	let editingLinkId = $state<string | null>(null);
	let linkDraft = $state<LinkDraft>(emptyLinkDraft());

	// Group id whose "add link" form is open.
	let addingLinkGroupId = $state<string | null>(null);
	let newLink = $state<LinkDraft>(emptyLinkDraft());

	let showNewGroup = $state(false);
	let newGroup = $state<GroupDraft>({ heading: '', annotation: '' });

	const groups = $derived(data.groups as Group[]);

	function resetForms() {
		editingGroupId = null;
		editingLinkId = null;
		addingLinkGroupId = null;
		showNewGroup = false;
		newGroup = { heading: '', annotation: '' };
		newLink = emptyLinkDraft();
	}

	/**
	 * Every mutation goes through here: one in-flight request at a time, errors
	 * surfaced verbatim from the endpoint, and a reload so positions and
	 * cascades show up without hand-patching local state.
	 */
	async function send(url: string, method: string, body?: unknown): Promise<boolean> {
		if (busy) return false;
		busy = true;
		actionError = '';
		try {
			const res = await fetch(url, {
				method,
				...(body === undefined
					? {}
					: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			});
			if (!res.ok) {
				actionError = await res.text();
				return false;
			}
			await invalidateAll();
			return true;
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Request failed.';
			return false;
		} finally {
			busy = false;
		}
	}

	function startEditGroup(group: Group) {
		editingLinkId = null;
		editingGroupId = group.id;
		groupDraft = { heading: group.heading, annotation: group.annotation ?? '' };
	}

	function startEditLink(link: Link) {
		editingGroupId = null;
		editingLinkId = link.id;
		linkDraft = {
			label: link.label,
			href: link.href,
			description: link.description ?? '',
			tag: link.tag ?? ''
		};
	}

	function groupBody(draft: GroupDraft) {
		return { heading: draft.heading.trim(), annotation: draft.annotation.trim() || null };
	}

	function linkBody(draft: LinkDraft) {
		return {
			label: draft.label.trim(),
			href: draft.href.trim(),
			description: draft.description.trim() || null,
			tag: draft.tag.trim() || null
		};
	}

	async function createGroup() {
		if (await send('/api/admin/community-links/groups', 'POST', groupBody(newGroup))) {
			resetForms();
		}
	}

	async function saveGroup(id: string) {
		if (
			await send(`/api/admin/community-links/groups/${id}`, 'PATCH', groupBody(groupDraft))
		) {
			editingGroupId = null;
		}
	}

	async function deleteGroup(group: Group) {
		const linkCount = group.links.length;
		const warning = linkCount
			? `Delete "${group.heading}" and its ${linkCount} link${linkCount === 1 ? '' : 's'}?`
			: `Delete "${group.heading}"?`;
		if (!confirm(warning)) return;
		await send(`/api/admin/community-links/groups/${group.id}`, 'DELETE');
	}

	async function createLink(groupId: string) {
		if (
			await send('/api/admin/community-links/links', 'POST', {
				groupId,
				...linkBody(newLink)
			})
		) {
			addingLinkGroupId = null;
			newLink = emptyLinkDraft();
		}
	}

	async function saveLink(id: string) {
		if (await send(`/api/admin/community-links/links/${id}`, 'PATCH', linkBody(linkDraft))) {
			editingLinkId = null;
		}
	}

	async function deleteLink(link: Link) {
		if (!confirm(`Remove "${link.label}" from the community page?`)) return;
		await send(`/api/admin/community-links/links/${link.id}`, 'DELETE');
	}

	async function move(kind: 'groups' | 'links', id: string, direction: 'up' | 'down') {
		await send(`/api/admin/community-links/${kind}/${id}/move`, 'POST', { direction });
	}

	function displayHost(href: string): string {
		try {
			return new URL(href).hostname.replace(/^www\./, '');
		} catch {
			return href;
		}
	}
</script>

<svelte:head>
	<title>Tyr HQ | Community links</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">Admin</p>
	<h1
		class="mt-2 font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
	>
		Community links
	</h1>
	<p class="mt-3 max-w-3xl text-sm leading-6 text-[var(--hud-muted)]">
		The link directory on
		<a href="/community" class="text-[var(--hud-teal)] hover:underline">the community page</a>.
		Groups and links render in the order shown here; a group with no links is hidden from the
		public page. Links must use https.
	</p>

	{#if !data.supabaseConfigured}
		<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
			Supabase isn't configured, so the public page is still serving the built-in fallback list
			and nothing can be edited here. Set SUPABASE_SERVICE_ROLE_KEY to manage links.
		</p>
	{/if}

	{#if actionError}
		<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
			{actionError}
		</p>
	{/if}

	{#if groups.length === 0}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">No groups yet. Add one to start the directory.</p>
		</div>
	{/if}

	<ul class="mt-8 flex flex-col gap-6">
		{#each groups as group, groupIndex (group.id)}
			<li
				class="rounded-sm bg-[var(--hud-panel)] p-6"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				{#if editingGroupId === group.id}
					<div class="flex flex-wrap items-end gap-2">
						<label class="flex flex-1 flex-col gap-1">
							<span
								class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
							>
								Heading
							</span>
							<input
								type="text"
								bind:value={groupDraft.heading}
								maxlength="80"
								class="hud-input min-w-[200px] rounded-sm px-3 py-2 text-sm"
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span
								class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
							>
								Annotation
							</span>
							<input
								type="text"
								bind:value={groupDraft.annotation}
								maxlength="40"
								placeholder="PLAYER-RUN"
								class="hud-input rounded-sm px-3 py-2 text-sm"
							/>
						</label>
						<button
							type="button"
							disabled={busy}
							onclick={() => saveGroup(group.id)}
							class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
						>
							Save
						</button>
						<button
							type="button"
							onclick={() => (editingGroupId = null)}
							class="hud-cta-ghost px-3 py-2 text-xs"
						>
							Cancel
						</button>
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<span
							class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
						>
							{group.heading}
						</span>
						{#if group.annotation}
							<span class="font-mono text-[10px] text-[var(--hud-muted)]">
								{group.annotation}
							</span>
						{/if}
						<span class="font-mono text-[10px] text-[var(--hud-dim)]">
							{group.links.length} link{group.links.length === 1 ? '' : 's'}
						</span>

						<span class="ml-auto flex items-center gap-1">
							<button
								type="button"
								disabled={busy || groupIndex === 0}
								onclick={() => move('groups', group.id, 'up')}
								aria-label="Move {group.heading} up"
								class="hud-cta-ghost px-2 py-1 text-xs disabled:opacity-30"
							>
								↑
							</button>
							<button
								type="button"
								disabled={busy || groupIndex === groups.length - 1}
								onclick={() => move('groups', group.id, 'down')}
								aria-label="Move {group.heading} down"
								class="hud-cta-ghost px-2 py-1 text-xs disabled:opacity-30"
							>
								↓
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => startEditGroup(group)}
								class="hud-cta-ghost px-3 py-1 text-xs disabled:opacity-50"
							>
								Edit
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => deleteGroup(group)}
								class="hud-cta-ghost px-3 py-1 text-xs text-[var(--hud-enemy)] disabled:opacity-50"
							>
								Delete
							</button>
						</span>
					</div>
				{/if}

				<ul class="mt-4 flex flex-col">
					{#each group.links as link, linkIndex (link.id)}
						<li class="border-t border-[var(--hud-variant)]/50 py-3">
							{#if editingLinkId === link.id}
								<div class="flex flex-col gap-2">
									<div class="flex flex-wrap gap-2">
										<input
											type="text"
											bind:value={linkDraft.label}
											maxlength="120"
											placeholder="Label"
											class="hud-input min-w-[200px] flex-1 rounded-sm px-3 py-2 text-sm"
										/>
										<input
											type="text"
											bind:value={linkDraft.tag}
											maxlength="24"
											placeholder="Tag (Discord, Wiki…)"
											class="hud-input rounded-sm px-3 py-2 text-sm"
										/>
									</div>
									<input
										type="url"
										bind:value={linkDraft.href}
										maxlength="1024"
										placeholder="https://…"
										class="hud-input rounded-sm px-3 py-2 text-sm"
									/>
									<input
										type="text"
										bind:value={linkDraft.description}
										maxlength="300"
										placeholder="One-line description"
										class="hud-input rounded-sm px-3 py-2 text-sm"
									/>
									<div class="flex flex-wrap gap-2">
										<button
											type="button"
											disabled={busy}
											onclick={() => saveLink(link.id)}
											class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
										>
											Save
										</button>
										<button
											type="button"
											onclick={() => (editingLinkId = null)}
											class="hud-cta-ghost px-3 py-2 text-xs"
										>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<div class="flex flex-wrap items-start gap-x-3 gap-y-1">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											{#if link.tag}
												<span
													class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-teal)]"
												>
													{link.tag}
												</span>
											{/if}
											<span class="text-sm font-semibold text-[var(--hud-text)]">
												{link.label}
											</span>
											<span
												class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
											>
												{displayHost(link.href)}
											</span>
										</div>
										{#if link.description}
											<p class="mt-1 text-xs leading-5 text-[var(--hud-muted)]">
												{link.description}
											</p>
										{/if}
										<a
											href={link.href}
											target="_blank"
											rel="noreferrer"
											class="mt-1 inline-block break-all font-mono text-[11px] text-[var(--hud-teal)] hover:underline"
										>
											{link.href}
										</a>
									</div>

									<div class="flex items-center gap-1">
										<button
											type="button"
											disabled={busy || linkIndex === 0}
											onclick={() => move('links', link.id, 'up')}
											aria-label="Move {link.label} up"
											class="hud-cta-ghost px-2 py-1 text-xs disabled:opacity-30"
										>
											↑
										</button>
										<button
											type="button"
											disabled={busy || linkIndex === group.links.length - 1}
											onclick={() => move('links', link.id, 'down')}
											aria-label="Move {link.label} down"
											class="hud-cta-ghost px-2 py-1 text-xs disabled:opacity-30"
										>
											↓
										</button>
										<button
											type="button"
											disabled={busy}
											onclick={() => startEditLink(link)}
											class="hud-cta-ghost px-3 py-1 text-xs disabled:opacity-50"
										>
											Edit
										</button>
										<button
											type="button"
											disabled={busy}
											onclick={() => deleteLink(link)}
											class="hud-cta-ghost px-3 py-1 text-xs text-[var(--hud-enemy)] disabled:opacity-50"
										>
											Remove
										</button>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				{#if addingLinkGroupId === group.id}
					<div class="mt-3 flex flex-col gap-2 border-t border-[var(--hud-variant)]/50 pt-3">
						<div class="flex flex-wrap gap-2">
							<input
								type="text"
								bind:value={newLink.label}
								maxlength="120"
								placeholder="Label"
								class="hud-input min-w-[200px] flex-1 rounded-sm px-3 py-2 text-sm"
							/>
							<input
								type="text"
								bind:value={newLink.tag}
								maxlength="24"
								placeholder="Tag (Discord, Wiki…)"
								class="hud-input rounded-sm px-3 py-2 text-sm"
							/>
						</div>
						<input
							type="url"
							bind:value={newLink.href}
							maxlength="1024"
							placeholder="https://…"
							class="hud-input rounded-sm px-3 py-2 text-sm"
						/>
						<input
							type="text"
							bind:value={newLink.description}
							maxlength="300"
							placeholder="One-line description"
							class="hud-input rounded-sm px-3 py-2 text-sm"
						/>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								disabled={busy}
								onclick={() => createLink(group.id)}
								class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
							>
								Add link
							</button>
							<button
								type="button"
								onclick={() => {
									addingLinkGroupId = null;
									newLink = emptyLinkDraft();
								}}
								class="hud-cta-ghost px-3 py-2 text-xs"
							>
								Cancel
							</button>
						</div>
					</div>
				{:else}
					<button
						type="button"
						disabled={busy}
						onclick={() => {
							resetForms();
							addingLinkGroupId = group.id;
						}}
						class="mt-3 hud-cta-ghost px-3 py-2 text-xs disabled:opacity-50"
					>
						+ Add link
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="mt-8">
		{#if showNewGroup}
			<div
				class="rounded-sm bg-[var(--hud-panel)] p-6"
				style="box-shadow: var(--hud-surface-ghost);"
			>
				<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
					New group
				</p>
				<div class="mt-3 flex flex-wrap items-end gap-2">
					<label class="flex flex-1 flex-col gap-1">
						<span class="text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
							Heading
						</span>
						<input
							type="text"
							bind:value={newGroup.heading}
							maxlength="80"
							placeholder="Sites & Tools"
							class="hud-input min-w-[200px] rounded-sm px-3 py-2 text-sm"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
							Annotation
						</span>
						<input
							type="text"
							bind:value={newGroup.annotation}
							maxlength="40"
							placeholder="FAN-MADE"
							class="hud-input rounded-sm px-3 py-2 text-sm"
						/>
					</label>
					<button
						type="button"
						disabled={busy}
						onclick={createGroup}
						class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
					>
						Create
					</button>
					<button
						type="button"
						onclick={() => (showNewGroup = false)}
						class="hud-cta-ghost px-3 py-2 text-xs"
					>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<button
				type="button"
				disabled={busy}
				onclick={() => {
					resetForms();
					showNewGroup = true;
				}}
				class="hud-cta-outline px-4 py-2 text-xs disabled:opacity-50"
			>
				+ Add group
			</button>
		{/if}
	</div>
</section>

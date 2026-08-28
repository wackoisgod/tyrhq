<script lang="ts">
	import { onMount } from 'svelte';

	type GuideLink = {
		slug: string;
		title: string;
		vehicleSlugs: string[];
	};

	let {
		open = $bindable(false),
		onPick
	}: {
		open: boolean;
		onPick: (guide: GuideLink) => void;
	} = $props();

	let guides = $state<GuideLink[]>([]);
	let loading = $state(false);
	let loadError = $state('');
	let loaded = false;
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return guides;
		return guides.filter(
			(guide) =>
				guide.title.toLowerCase().includes(q) ||
				guide.slug.includes(q) ||
				guide.vehicleSlugs.some((slug) => slug.includes(q))
		);
	});

	async function load() {
		if (loading) return;
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/contribute/guides');
			if (!res.ok) {
				loadError = (await res.text()) || `Failed to load guides (${res.status}).`;
				return;
			}
			guides = await res.json();
			loaded = true;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load guides.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && !loaded) load();
	});

	function close() {
		open = false;
		query = '';
	}

	function pick(guide: GuideLink) {
		onPick(guide);
		close();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) close();
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		onclick={close}
	>
		<div
			class="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-sm bg-[var(--hud-panel)] shadow-2xl"
			style="box-shadow: var(--hud-surface-ghost);"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label="Link a published guide"
			tabindex="-1"
		>
			<div class="flex items-center justify-between border-b border-[var(--hud-inset)] p-4">
				<div>
					<div
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
					>
						Guide library
					</div>
					<h2 class="mt-1 text-sm text-[var(--hud-text)]">
						Pick a published guide to link
					</h2>
				</div>
				<button
					type="button"
					onclick={close}
					class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-dim)] transition hover:text-[var(--hud-lime)]"
				>
					Close ✕
				</button>
			</div>

			<div class="border-b border-[var(--hud-inset)] p-3">
				<input
					type="text"
					bind:value={query}
					placeholder="Search guides by title or vehicle…"
					class="hud-input w-full rounded-sm px-3 py-2 text-sm"
				/>
			</div>

			<div class="flex-1 overflow-auto p-3">
				{#if loading}
					<p class="text-xs text-[var(--hud-dim)]">Loading…</p>
				{:else if loadError}
					<p class="text-xs text-[var(--hud-lime)]">{loadError}</p>
				{:else if filtered.length === 0}
					<p class="text-xs text-[var(--hud-dim)]">
						{guides.length === 0 ? 'No published guides yet.' : 'No guides match your search.'}
					</p>
				{:else}
					<div class="grid gap-1.5">
						{#each filtered as guide (guide.slug)}
							<button
								type="button"
								onclick={() => pick(guide)}
								class="flex flex-col gap-0.5 rounded-sm bg-[var(--hud-inset)] px-3 py-2 text-left transition hover:shadow-[inset_0_0_0_2px_var(--hud-teal)]"
							>
								<span class="text-sm text-[var(--hud-text)]">{guide.title}</span>
								<span class="text-[10px] uppercase tracking-[0.14em] text-[var(--hud-dim)]">
									/guides/{guide.slug}{guide.vehicleSlugs.length
										? ` · ${guide.vehicleSlugs.join(', ')}`
										: ''}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

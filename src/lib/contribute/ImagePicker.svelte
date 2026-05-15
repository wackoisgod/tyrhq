<script lang="ts">
	import { onMount } from 'svelte';

	type Upload = {
		url: string;
		mime: string;
		width: number | null;
		height: number | null;
		byteSize: number;
		createdAt: string;
		uploaderId: string;
		uploaderName: string | null;
	};

	let {
		open = $bindable(false),
		onPick
	}: {
		open: boolean;
		onPick: (upload: Upload) => void;
	} = $props();

	let uploads = $state<Upload[]>([]);
	let scope = $state<'shared' | 'own'>('own');
	let loading = $state(false);
	let loadError = $state('');
	let loaded = false;

	async function load() {
		if (loading) return;
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/contribute/images');
			if (!res.ok) {
				loadError = (await res.text()) || `Failed to load uploads (${res.status}).`;
				return;
			}
			const data = await res.json();
			uploads = data.uploads ?? [];
			scope = data.scope === 'shared' ? 'shared' : 'own';
			loaded = true;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load uploads.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && !loaded) load();
	});

	function close() {
		open = false;
	}

	function pick(upload: Upload) {
		onPick(upload);
		close();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) close();
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString();
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
			class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-sm bg-[var(--hud-panel)] shadow-2xl"
			style="box-shadow: var(--hud-surface-ghost);"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label="Choose a previously uploaded image"
			tabindex="-1"
		>
			<div
				class="flex items-center justify-between border-b border-[var(--hud-inset)] p-4"
			>
				<div>
					<div
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
					>
						Image library
					</div>
					<h2 class="mt-1 text-sm text-[var(--hud-text)]">
						{scope === 'shared'
							? 'Pick from shared contributor uploads'
							: 'Pick from your previous uploads'}
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

			<div class="flex-1 overflow-auto p-4">
				{#if loading}
					<p class="text-xs text-[var(--hud-dim)]">Loading…</p>
				{:else if loadError}
					<p class="text-xs text-[var(--hud-lime)]">{loadError}</p>
				{:else if uploads.length === 0}
					<p class="text-xs text-[var(--hud-dim)]">
						{scope === 'shared'
							? 'No contributor uploads yet. Use the Image button to upload one.'
							: "You haven't uploaded any images yet. Use the Image button to upload one."}
					</p>
				{:else}
					<div
						class="grid gap-3"
						style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));"
					>
						{#each uploads as upload}
							{@const uploaderLabel = upload.uploaderName?.trim() || 'Unknown'}
							<button
								type="button"
								onclick={() => pick(upload)}
								class="group flex flex-col gap-1 rounded-sm bg-[var(--hud-inset)] p-1.5 text-left transition hover:shadow-[inset_0_0_0_2px_var(--hud-teal)]"
								title="{uploaderLabel} · {formatDate(upload.createdAt)} · {formatBytes(upload.byteSize)}{upload.width && upload.height ? ` · ${upload.width}×${upload.height}` : ''}"
							>
								<img
									src={upload.url}
									alt=""
									loading="lazy"
									decoding="async"
									class="aspect-square w-full rounded-sm bg-black/40 object-cover"
								/>
								{#if scope === 'shared'}
									<span
										class="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--hud-text)] group-hover:text-[var(--hud-teal)]"
									>
										{uploaderLabel}
									</span>
									<span
										class="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--hud-dim)]"
									>
										{formatDate(upload.createdAt)}
									</span>
								{:else}
									<span
										class="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--hud-dim)] group-hover:text-[var(--hud-teal)]"
									>
										{formatDate(upload.createdAt)}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div
				class="flex items-center justify-between border-t border-[var(--hud-inset)] p-3 text-[11px] text-[var(--hud-dim)]"
			>
				<span>{uploads.length} image{uploads.length === 1 ? '' : 's'}</span>
				<button
					type="button"
					onclick={load}
					disabled={loading}
					class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--hud-dim)] transition hover:text-[var(--hud-teal)] disabled:opacity-50"
				>
					{loading ? 'Refreshing…' : 'Refresh'}
				</button>
			</div>
		</div>
	</div>
{/if}

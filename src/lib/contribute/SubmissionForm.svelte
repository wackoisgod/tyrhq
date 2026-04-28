<script lang="ts">
	import Editor from './Editor.svelte';
	import { goto } from '$app/navigation';
	import { FLYOUT_SECTIONS, type FlyoutSection } from '$lib/content/flyout-sections';

	type Submission = {
		id: string;
		type: 'guide' | 'article';
		title: string;
		summary: string | null;
		slug: string | null;
		body_markdown: string;
		body_html: string;
		tags: string[];
		vehicle_slugs: string[] | null;
		status: string;
		review_notes: string | null;
		flyout_section: FlyoutSection | null;
	};

	let {
		submission = null,
		defaultType = 'guide'
	}: { submission?: Submission | null; defaultType?: 'guide' | 'article' } = $props();

	// Form fields copy the initial submission into local state and become the
	// editable source of truth; further updates from the parent are intentionally
	// ignored (the page reloads after navigation, which re-mounts this form).

	/* svelte-ignore state_referenced_locally */
	let id = $state(submission?.id ?? '');
	/* svelte-ignore state_referenced_locally */
	let type = $state<'guide' | 'article'>(submission?.type ?? defaultType);
	/* svelte-ignore state_referenced_locally */
	let title = $state(submission?.title ?? '');
	/* svelte-ignore state_referenced_locally */
	let summary = $state(submission?.summary ?? '');
	/* svelte-ignore state_referenced_locally */
	let slug = $state(submission?.slug ?? '');
	/* svelte-ignore state_referenced_locally */
	let bodyMarkdown = $state(submission?.body_markdown ?? '');
	/* svelte-ignore state_referenced_locally */
	let tagsInput = $state((submission?.tags ?? []).join(', '));
	/* svelte-ignore state_referenced_locally */
	let vehicleSlugsInput = $state((submission?.vehicle_slugs ?? []).join(', '));
	/* svelte-ignore state_referenced_locally */
	let status = $state(submission?.status ?? 'draft');
	/* svelte-ignore state_referenced_locally */
	let reviewNotes = $state(submission?.review_notes ?? '');
	/* svelte-ignore state_referenced_locally */
	let flyoutSection = $state<FlyoutSection | ''>(submission?.flyout_section ?? '');

	let saving = $state(false);
	let submittingForReview = $state(false);
	let previewing = $state(false);
	let saveError = $state('');
	let lastSavedAt = $state<string>('');

	function parseList(input: string): string[] {
		return input
			.split(/[,\n]/)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function buildPayload() {
		return {
			id: id || undefined,
			type,
			title,
			summary: summary || null,
			slug: slug || null,
			bodyMarkdown,
			tags: parseList(tagsInput),
			vehicleSlugs: type === 'guide' ? parseList(vehicleSlugsInput) : null,
			flyoutSection: flyoutSection || null
		};
	}

	async function saveDraft() {
		if (saving || submittingForReview) return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch('/api/contribute/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildPayload())
			});
			if (!res.ok) {
				saveError = await res.text();
				return;
			}
			const data = await res.json();
			id = data.id;
			status = data.status;
			lastSavedAt = new Date().toLocaleTimeString();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function previewOnSite() {
		if (saving || submittingForReview || previewing) return;
		// Open the tab synchronously so we don't trip the popup blocker — the
		// browser only honors window.open inside a direct user-gesture handler.
		// We then fetch + redirect that tab to the preview URL once we have an id.
		const previewWindow = window.open('about:blank', '_blank');
		previewing = true;
		saveError = '';
		try {
			const res = await fetch('/api/contribute/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildPayload())
			});
			if (!res.ok) {
				saveError = await res.text();
				previewWindow?.close();
				return;
			}
			const data = await res.json();
			id = data.id;
			status = data.status;
			lastSavedAt = new Date().toLocaleTimeString();
			const target = `/contribute/${id}/preview`;
			if (previewWindow) {
				previewWindow.location.href = target;
			} else {
				// popup blocked — fall back to a same-tab navigation
				window.location.href = target;
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Preview failed';
			previewWindow?.close();
		} finally {
			previewing = false;
		}
	}

	async function submitForReview() {
		if (submittingForReview || saving) return;
		submittingForReview = true;
		saveError = '';
		try {
			// Always save first, so the latest body is what gets submitted
			const saveRes = await fetch('/api/contribute/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildPayload())
			});
			if (!saveRes.ok) {
				saveError = await saveRes.text();
				return;
			}
			const saved = await saveRes.json();
			id = saved.id;

			const submitRes = await fetch(`/api/contribute/submissions/${id}/submit`, {
				method: 'POST'
			});
			if (!submitRes.ok) {
				saveError = await submitRes.text();
				return;
			}
			await goto('/contribute/mine');
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Submit failed';
		} finally {
			submittingForReview = false;
		}
	}

	const editable = $derived(
		!status || status === 'draft' || status === 'changes_requested'
	);
</script>

<form
	class="flex flex-col gap-5"
	onsubmit={(e) => {
		e.preventDefault();
		saveDraft();
	}}
>
	{#if status === 'pending'}
		<div
			class="rounded-sm border-l-2 border-[var(--hud-teal)] bg-[var(--hud-teal)]/10 p-3 text-sm text-[var(--hud-text)]"
		>
			This submission is in review. You can't edit it until the reviewer responds.
		</div>
	{:else if status === 'changes_requested'}
		<div
			class="rounded-sm border-l-2 border-[var(--hud-lime)] bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-text)]"
		>
			<div
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Changes requested
			</div>
			{#if reviewNotes}
				<p class="mt-1 whitespace-pre-wrap">{reviewNotes}</p>
			{/if}
			<p class="mt-2 text-xs text-[var(--hud-muted)]">
				Make your edits below and resubmit.
			</p>
		</div>
	{:else if status === 'rejected'}
		<div
			class="rounded-sm border-l-2 border-[var(--hud-dim)] bg-[var(--hud-panel-mid)] p-3 text-sm text-[var(--hud-text)]"
		>
			<div
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Submission rejected
			</div>
			{#if reviewNotes}
				<p class="mt-1 whitespace-pre-wrap">{reviewNotes}</p>
			{/if}
		</div>
	{:else if status === 'published'}
		<div
			class="rounded-sm border-l-2 border-[var(--hud-teal)] bg-[var(--hud-teal)]/10 p-3 text-sm text-[var(--hud-text)]"
		>
			This article is live. To make further changes, head to the published page and use
			"Suggest an edit".
		</div>
	{/if}

	<fieldset disabled={!editable} class="flex flex-col gap-5 disabled:opacity-60">
		<fieldset class="grid gap-3 md:grid-cols-[150px_1fr]">
			<legend class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				Type
			</legend>
			<div class="flex gap-3">
				<label class="flex items-center gap-2 text-sm text-[var(--hud-text)]">
					<input type="radio" bind:group={type} name="type" value="guide" /> Guide
				</label>
				<label class="flex items-center gap-2 text-sm text-[var(--hud-text)]">
					<input type="radio" bind:group={type} name="type" value="article" /> Article
				</label>
			</div>
		</fieldset>

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<label
				for="title"
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>Title</label
			>
			<input
				id="title"
				bind:value={title}
				type="text"
				required
				maxlength="200"
				class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
			/>
		</div>

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<label
				for="summary"
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>Summary</label
			>
			<textarea
				id="summary"
				bind:value={summary}
				maxlength="500"
				rows="2"
				placeholder="A short one-liner shown on listing pages."
				class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
			></textarea>
		</div>

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<label
				for="slug"
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>Slug (optional)</label
			>
			<input
				id="slug"
				bind:value={slug}
				type="text"
				maxlength="80"
				placeholder="auto-generated from title if blank"
				class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
			/>
		</div>

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<label
				for="tags"
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>Tags</label
			>
			<input
				id="tags"
				bind:value={tagsInput}
				type="text"
				placeholder="comma-separated, e.g. heavy, survival"
				class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
			/>
		</div>

		{#if type === 'guide'}
			<div class="grid gap-3 md:grid-cols-[150px_1fr]">
				<label
					for="vehicles"
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>Vehicles</label
				>
				<input
					id="vehicles"
					bind:value={vehicleSlugsInput}
					type="text"
					placeholder="comma-separated tank slugs, e.g. atlas, hammer"
					class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
				/>
			</div>
		{/if}

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<label
				for="flyoutSection"
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>Resources flyout</label
			>
			<div class="flex flex-col gap-1">
				<select
					id="flyoutSection"
					bind:value={flyoutSection}
					class="rounded-sm bg-[var(--hud-inset)] p-2 text-sm text-[var(--hud-text)] outline-none focus:shadow-[inset_0_0_0_1px_var(--hud-teal)]"
				>
					<option value="">— Not in Resources flyout —</option>
					{#each FLYOUT_SECTIONS as section}
						<option value={section}>{section}</option>
					{/each}
				</select>
				<p class="text-[11px] text-[var(--hud-dim)]">
					Optional. Suggest a heading under which this should appear in the top-nav Resources
					menu. A reviewer will confirm or adjust on approval.
				</p>
			</div>
		</div>

		<div>
			<div
				class="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Body
			</div>
			<div class="mt-2">
				<Editor bind:value={bodyMarkdown} />
			</div>
		</div>
	</fieldset>

	{#if saveError}
		<p class="rounded-sm bg-[var(--hud-lime)]/10 p-3 text-sm text-[var(--hud-lime)]">
			{saveError}
		</p>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-xs text-[var(--hud-dim)]">
			{#if lastSavedAt}Saved at {lastSavedAt}{:else if id}Loaded existing draft{/if}
		</p>
		<div class="flex flex-wrap items-center gap-3">
			{#if editable}
				<button
					type="button"
					onclick={saveDraft}
					disabled={saving || submittingForReview || previewing}
					class="hud-cta-outline px-5 py-3 text-sm disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save Draft'}
				</button>
				<button
					type="button"
					onclick={previewOnSite}
					disabled={saving || submittingForReview || previewing || !title.trim() || !bodyMarkdown.trim()}
					class="hud-cta-ghost px-5 py-3 text-sm disabled:opacity-50"
					title="Save and open a full-page preview in a new tab"
				>
					{previewing ? 'Opening…' : 'Preview On Site'}
				</button>
				<button
					type="button"
					onclick={submitForReview}
					disabled={saving || submittingForReview || previewing || !title.trim() || !bodyMarkdown.trim()}
					class="hud-cta px-5 py-3 text-sm disabled:opacity-50"
				>
					{submittingForReview ? 'Submitting…' : 'Submit For Review'}
				</button>
			{/if}
		</div>
	</div>
</form>

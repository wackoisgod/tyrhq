<script lang="ts">
	import Editor from './Editor.svelte';
	import ImagePicker from './ImagePicker.svelte';
	import ReviewerSuggestions from './ReviewerSuggestions.svelte';
	import { goto } from '$app/navigation';
	import { FLYOUT_SECTIONS, type FlyoutSection } from '$lib/content/flyout-sections';
	import { uploadArticleImage } from './upload-image';

	type Submission = {
		id: string;
		type: 'guide' | 'article' | 'patch';
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
		hero_image_url: string | null;
		version: string | null;
		reviewer_body_markdown?: string | null;
	};

	let {
		submission = null,
		defaultType = 'guide'
	}: { submission?: Submission | null; defaultType?: 'guide' | 'article' | 'patch' } = $props();

	// Form fields copy the initial submission into local state and become the
	// editable source of truth; further updates from the parent are intentionally
	// ignored (the page reloads after navigation, which re-mounts this form).

	/* svelte-ignore state_referenced_locally */
	let id = $state(submission?.id ?? '');
	/* svelte-ignore state_referenced_locally */
	let type = $state<'guide' | 'article' | 'patch'>(submission?.type ?? defaultType);
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
	/* svelte-ignore state_referenced_locally */
	let heroImageUrl = $state<string | null>(submission?.hero_image_url ?? null);
	/* svelte-ignore state_referenced_locally */
	let version = $state(submission?.version ?? '');
	// The reviewer's inline-edit proposal (if any). The diff base stays pinned to
	// the originally-submitted body via `suggestionBase` so editing the body
	// doesn't shift the suggestions out from under the author.
	/* svelte-ignore state_referenced_locally */
	const suggestionBase = submission?.body_markdown ?? '';
	/* svelte-ignore state_referenced_locally */
	let reviewerBodyMarkdown = $state<string | null>(submission?.reviewer_body_markdown ?? null);
	let suggestionsResolved = $state(false);
	const showSuggestions = $derived(
		!suggestionsResolved && !!reviewerBodyMarkdown && reviewerBodyMarkdown !== suggestionBase
	);

	function applySuggestions(mergedBody: string) {
		bodyMarkdown = mergedBody;
		reviewerBodyMarkdown = null;
		suggestionsResolved = true;
	}

	let saving = $state(false);
	let submittingForReview = $state(false);
	let previewing = $state(false);
	let saveError = $state('');
	let lastSavedAt = $state<string>('');
	let heroUploading = $state(false);
	let heroError = $state('');
	let heroInput = $state<HTMLInputElement | undefined>();
	let heroPickerOpen = $state(false);

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
			flyoutSection: type === 'patch' ? null : flyoutSection || null,
			heroImageUrl: heroImageUrl || null,
			version: type === 'patch' ? version.trim() || null : null,
			clearReviewerSuggestions: suggestionsResolved || undefined
		};
	}

	async function uploadHero(file: File) {
		heroError = '';
		heroUploading = true;
		try {
			const data = await uploadArticleImage(file, { submissionId: id });
			heroImageUrl = data.url;
		} catch (err) {
			heroError = err instanceof Error ? err.message : 'Upload failed.';
		} finally {
			heroUploading = false;
		}
	}

	async function onHeroSelected(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		await uploadHero(file);
		target.value = '';
	}

	function clearHero() {
		heroImageUrl = null;
		heroError = '';
	}

	function onHeroLibraryPick(upload: { url: string }) {
		heroImageUrl = upload.url;
		heroError = '';
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
		!status ||
			status === 'draft' ||
			status === 'pending' ||
			status === 'changes_requested' ||
			status === 'rejected'
	);
	const alreadySubmitted = $derived(status === 'pending');
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
			<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
				In review
			</div>
			<p class="mt-1">
				This submission is queued for review. You can keep editing until a reviewer responds; saved
				changes will be visible on the next reviewer pass. No need to resubmit.
			</p>
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
				{#if showSuggestions}
					Review the reviewer's suggested edits below, then make any further changes and resubmit.
				{:else}
					Make your edits below and resubmit.
				{/if}
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
			<p class="mt-2 text-xs text-[var(--hud-muted)]">
				You can revise this draft and resubmit for review.
			</p>
		</div>
	{:else if status === 'published'}
		<div
			class="rounded-sm border-l-2 border-[var(--hud-teal)] bg-[var(--hud-teal)]/10 p-3 text-sm text-[var(--hud-text)]"
		>
			This article is live. To make further changes, head to the published page and use
			"Suggest an edit".
		</div>
	{/if}

	{#if showSuggestions && reviewerBodyMarkdown}
		<ReviewerSuggestions
			base={suggestionBase}
			proposed={reviewerBodyMarkdown}
			busy={saving || submittingForReview}
			onApply={applySuggestions}
		/>
	{/if}

	<fieldset disabled={!editable} class="flex flex-col gap-5 disabled:opacity-60">
		<fieldset class="grid gap-3 md:grid-cols-[150px_1fr]">
			<legend class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]">
				Type
			</legend>
			<div class="flex flex-wrap gap-3">
				<label class="flex items-center gap-2 text-sm text-[var(--hud-text)]">
					<input type="radio" bind:group={type} name="type" value="guide" /> Guide
				</label>
				<label class="flex items-center gap-2 text-sm text-[var(--hud-text)]">
					<input type="radio" bind:group={type} name="type" value="article" /> Article
				</label>
				<label class="flex items-center gap-2 text-sm text-[var(--hud-text)]">
					<input type="radio" bind:group={type} name="type" value="patch" /> Patch Notes
				</label>
			</div>
		</fieldset>

		{#if type === 'patch'}
			<div class="grid gap-3 md:grid-cols-[150px_1fr]">
				<label
					for="version"
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>Version</label
				>
				<input
					id="version"
					bind:value={version}
					type="text"
					maxlength="40"
					placeholder="e.g. v0.5.2"
					class="hud-input rounded-sm p-2 text-sm"
				/>
			</div>
		{/if}

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
				class="hud-input rounded-sm p-2 text-sm"
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
				class="hud-input rounded-sm p-2 text-sm"
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
				class="hud-input rounded-sm p-2 text-sm"
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
				class="hud-input rounded-sm p-2 text-sm"
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
					class="hud-input rounded-sm p-2 text-sm"
				/>
			</div>
		{/if}

		{#if type !== 'patch'}
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
						class="hud-input rounded-sm p-2 text-sm"
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
		{/if}

		<div class="grid gap-3 md:grid-cols-[150px_1fr]">
			<span
				class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Hero image
			</span>
			<div class="flex flex-col gap-2">
				{#if heroImageUrl}
					<div class="flex flex-wrap items-start gap-3">
						<img
							src={heroImageUrl}
							alt="Hero preview"
							class="max-h-32 rounded-sm bg-[var(--hud-inset)] object-cover"
						/>
						<div class="flex flex-col gap-2">
							<button
								type="button"
								class="hud-cta-ghost px-3 py-1.5 text-xs"
								onclick={() => heroInput?.click()}
								disabled={heroUploading}
							>
								{heroUploading ? 'Uploading…' : 'Replace'}
							</button>
							<button
								type="button"
								class="hud-cta-ghost px-3 py-1.5 text-xs"
								onclick={() => (heroPickerOpen = true)}
								disabled={heroUploading}
							>
								Choose existing
							</button>
							<button
								type="button"
								class="hud-cta-ghost px-3 py-1.5 text-xs"
								onclick={clearHero}
								disabled={heroUploading}
							>
								Remove
							</button>
						</div>
					</div>
				{:else}
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="hud-cta-outline px-4 py-2 text-xs"
							onclick={() => heroInput?.click()}
							disabled={heroUploading}
						>
							{heroUploading ? 'Uploading…' : 'Upload hero image'}
						</button>
						<button
							type="button"
							class="hud-cta-ghost px-4 py-2 text-xs"
							onclick={() => (heroPickerOpen = true)}
							disabled={heroUploading}
						>
							Choose existing
						</button>
					</div>
				{/if}
				<input
					bind:this={heroInput}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					class="hidden"
					onchange={onHeroSelected}
				/>
				{#if heroError}
					<p class="text-xs text-[var(--hud-lime)]">{heroError}</p>
				{:else}
					<p class="text-[11px] text-[var(--hud-dim)]">
						Optional. Shown as the article banner and on listing cards.
					</p>
				{/if}
			</div>
		</div>

		<div>
			<div
				class="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
			>
				Body
			</div>
			<div class="mt-2">
				<Editor bind:value={bodyMarkdown} submissionId={id} />
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
				{#if !alreadySubmitted}
					<button
						type="button"
						onclick={submitForReview}
						disabled={saving || submittingForReview || previewing || !title.trim() || !bodyMarkdown.trim()}
						class="hud-cta px-5 py-3 text-sm disabled:opacity-50"
					>
						{submittingForReview ? 'Submitting…' : 'Submit For Review'}
					</button>
				{/if}
			{/if}
		</div>
	</div>
</form>

<ImagePicker bind:open={heroPickerOpen} onPick={onHeroLibraryPick} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { registerArticleCustomElements } from './custom-elements';
	import ImagePicker from './ImagePicker.svelte';
	import { uploadArticleImage } from './upload-image';

	/**
	 * MVP editor: textarea + friendly toolbar + live preview.
	 *
	 * The plan called for Tiptap WYSIWYG; that's the intended v2 upgrade.
	 * For the first cut we ship a markdown editor with a button toolbar that
	 * inserts the same shortcodes Tiptap would emit (`::youtube{id="..."}`,
	 * `:::callout{type="info"} ... :::`, `:stat{tank="..." stat="..."}`).
	 * Combined with the live preview pane
	 * (which uses the *real* server-side sanitiser, so what you see is what
	 * gets published), it covers the "non-technical contributor" use case
	 * without locking us into Tiptap's Svelte 5 integration story.
	 */

	let {
		value = $bindable(''),
		placeholder = 'Write your article here. Use the toolbar above for formatting.',
		submissionId = ''
	}: { value: string; placeholder?: string; submissionId?: string } = $props();

	let textarea: HTMLTextAreaElement | undefined = $state();
	let imageInput: HTMLInputElement | undefined = $state();
	let previewHtml = $state('');
	let previewError = $state('');
	let previewLoading = $state(false);
	let showPreview = $state(false);
	let lastPreviewedAt = 0;
	let uploadingImage = $state(false);
	let uploadError = $state('');
	let dragActive = $state(false);
	let pickerOpen = $state(false);

	onMount(() => {
		registerArticleCustomElements();
	});

	function wrapSelection(prefix: string, suffix: string = prefix, placeholderText = '') {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selected = value.slice(start, end) || placeholderText;
		const before = value.slice(0, start);
		const after = value.slice(end);
		value = `${before}${prefix}${selected}${suffix}${after}`;
		// Re-focus + select the inserted content
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = before.length + prefix.length;
			textarea.setSelectionRange(cursor, cursor + selected.length);
		});
	}

	function insertAtLineStart(token: string) {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const lineStart = value.lastIndexOf('\n', start - 1) + 1;
		const before = value.slice(0, lineStart);
		const after = value.slice(lineStart);
		value = `${before}${token}${after}`;
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = lineStart + token.length;
			textarea.setSelectionRange(cursor, cursor);
		});
	}

	function insertBlock(snippet: string) {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const before = value.slice(0, start);
		const after = value.slice(start);
		const needsLeadingNewline = before.length > 0 && !before.endsWith('\n\n');
		const needsTrailingNewline = !after.startsWith('\n');
		const block = `${needsLeadingNewline ? '\n\n' : ''}${snippet}${needsTrailingNewline ? '\n\n' : ''}`;
		value = `${before}${block}${after}`;
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = before.length + block.length;
			textarea.setSelectionRange(cursor, cursor);
		});
	}

	function insertYoutube() {
		const id = window.prompt(
			'YouTube video ID (the 11-character code from the URL, e.g. dQw4w9WgXcQ):',
			''
		);
		if (!id) return;
		const cleaned = id.trim();
		if (!/^[A-Za-z0-9_-]{11}$/.test(cleaned)) {
			window.alert(
				'That doesn’t look like a YouTube video ID. The ID is the 11-character code at the end of the URL.'
			);
			return;
		}
		insertBlock(`::youtube{id="${cleaned}"}`);
	}

	function insertCallout(type: 'info' | 'warning' | 'tip') {
		insertBlock(`:::callout{type="${type}"}\nYour callout text here.\n:::`);
	}

	function insertStat() {
		if (!textarea) return;
		const tank = window.prompt('Vehicle slug (e.g. atlas):', '');
		if (!tank) return;
		const stat =
			window.prompt('Stat (e.g. health, speed, damage, reload, penetration):', 'health') || 'health';
		const snippet = `:stat{tank="${tank.trim()}" stat="${stat.trim()}"}`;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const before = value.slice(0, start);
		const after = value.slice(end);
		value = `${before}${snippet}${after}`;
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const cursor = before.length + snippet.length;
			textarea.setSelectionRange(cursor, cursor);
		});
	}

	function insertLink() {
		if (!textarea) return;
		const url = window.prompt('Link URL (https://...):', 'https://');
		if (!url) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selected = value.slice(start, end) || 'link text';
		const before = value.slice(0, start);
		const after = value.slice(end);
		value = `${before}[${selected}](${url})${after}`;
		queueMicrotask(() => textarea?.focus());
	}

	async function uploadImageFile(file: File) {
		uploadError = '';
		uploadingImage = true;
		try {
			const data = await uploadArticleImage(file, { submissionId: submissionId || null });
			const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '');
			insertBlock(`![${alt}](${data.url})`);
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed.';
		} finally {
			uploadingImage = false;
		}
	}

	function pickImage() {
		uploadError = '';
		imageInput?.click();
	}

	function openLibrary() {
		uploadError = '';
		pickerOpen = true;
	}

	function onLibraryPick(upload: { url: string }) {
		insertBlock(`![](${upload.url})`);
	}

	async function onImageSelected(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		await uploadImageFile(file);
		// Reset so picking the same file again still fires `change`.
		target.value = '';
	}

	function onTextareaDragEnter(event: DragEvent) {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		dragActive = true;
	}

	function onTextareaDragOver(event: DragEvent) {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		dragActive = true;
	}

	function onTextareaDragLeave(event: DragEvent) {
		// Only clear when leaving the textarea entirely (not bubbling between children).
		if (event.currentTarget === event.target) dragActive = false;
	}

	async function onTextareaDrop(event: DragEvent) {
		if (!event.dataTransfer?.files?.length) return;
		event.preventDefault();
		dragActive = false;
		const file = event.dataTransfer.files[0];
		if (!file.type.startsWith('image/')) {
			uploadError = 'Drop an image file (PNG, JPEG, WebP, or GIF).';
			return;
		}
		await uploadImageFile(file);
	}

	async function refreshPreview() {
		const now = Date.now();
		lastPreviewedAt = now;
		previewLoading = true;
		previewError = '';
		try {
			const res = await fetch('/api/contribute/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ bodyMarkdown: value })
			});
			if (lastPreviewedAt !== now) return; // raced; newer request in flight
			if (!res.ok) {
				const message = await res.text();
				previewError = message || `Preview failed (${res.status})`;
				previewHtml = '';
				return;
			}
			const data = await res.json();
			previewHtml = data.html ?? '';
			// custom elements may have just been added
			registerArticleCustomElements();
		} catch (err) {
			if (lastPreviewedAt !== now) return;
			previewError = err instanceof Error ? err.message : 'Preview failed';
			previewHtml = '';
		} finally {
			if (lastPreviewedAt === now) previewLoading = false;
		}
	}

	function togglePreview() {
		showPreview = !showPreview;
		if (showPreview) refreshPreview();
	}

	let previewDebounce: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// re-run preview when body changes, debounced
		void value;
		if (!showPreview) return;
		if (previewDebounce) clearTimeout(previewDebounce);
		previewDebounce = setTimeout(refreshPreview, 600);
	});
</script>

<div
	class="rounded-sm bg-[var(--hud-panel)] p-3"
	style="box-shadow: var(--hud-surface-ghost);"
>
	<div class="mb-2 flex flex-wrap items-center gap-1">
		<button type="button" class="tb-btn" onclick={() => wrapSelection('**', '**', 'bold')}>
			<strong>B</strong>
		</button>
		<button type="button" class="tb-btn" onclick={() => wrapSelection('*', '*', 'italic')}>
			<em>I</em>
		</button>
		<span class="tb-sep"></span>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('# ')}>H1</button>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('## ')}>H2</button>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('### ')}>H3</button>
		<span class="tb-sep"></span>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('- ')} title="Bulleted list">• List</button>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('1. ')} title="Numbered list">1. List</button>
		<button type="button" class="tb-btn" onclick={() => insertAtLineStart('> ')} title="Quote">&gt;</button>
		<button type="button" class="tb-btn" onclick={() => wrapSelection('`', '`', 'code')} title="Inline code">&lt;/&gt;</button>
		<button type="button" class="tb-btn" onclick={insertLink} title="Link">Link</button>
		<button
			type="button"
			class="tb-btn"
			onclick={pickImage}
			disabled={uploadingImage}
			title="Upload an image"
		>
			{uploadingImage ? '⇪ Uploading…' : '🖼 Image'}
		</button>
		<button
			type="button"
			class="tb-btn"
			onclick={openLibrary}
			title="Pick from your previously uploaded images"
		>
			📁 Library
		</button>
		<input
			bind:this={imageInput}
			type="file"
			accept="image/png,image/jpeg,image/webp,image/gif"
			class="hidden"
			onchange={onImageSelected}
		/>
		<span class="tb-sep"></span>
		<button type="button" class="tb-btn" onclick={insertYoutube} title="Insert YouTube video">▶ YouTube</button>
		<button type="button" class="tb-btn" onclick={() => insertCallout('info')} title="Info callout">ⓘ Info</button>
		<button type="button" class="tb-btn" onclick={() => insertCallout('warning')} title="Warning callout">⚠ Warning</button>
		<button type="button" class="tb-btn" onclick={() => insertCallout('tip')} title="Tip callout">★ Tip</button>
		<button
			type="button"
			class="tb-btn"
			onclick={insertStat}
			title="Insert a live game-data value (e.g. a tank's HP)">＃ Stat</button
		>
		<span class="tb-sep ml-auto"></span>
		<button
			type="button"
			class="tb-btn {showPreview ? 'tb-btn-active' : ''}"
			onclick={togglePreview}
		>
			{showPreview ? 'Hide preview' : 'Show preview'}
		</button>
	</div>

	{#if uploadError}
		<p class="mb-2 rounded-sm bg-[var(--hud-lime)]/10 p-2 text-xs text-[var(--hud-lime)]">
			{uploadError}
		</p>
	{/if}

	<div class={showPreview ? 'grid gap-3 md:grid-cols-2' : ''}>
		<textarea
			bind:this={textarea}
			bind:value
			{placeholder}
			class="hud-input min-h-[420px] w-full resize-y rounded-sm p-3 font-mono text-sm leading-6 {dragActive
				? 'shadow-[inset_0_0_0_2px_var(--hud-teal)]'
				: ''}"
			spellcheck="true"
			ondragenter={onTextareaDragEnter}
			ondragover={onTextareaDragOver}
			ondragleave={onTextareaDragLeave}
			ondrop={onTextareaDrop}
		></textarea>

		{#if showPreview}
			<div class="min-h-[420px] rounded-sm bg-[var(--hud-inset)] p-3">
				<div
					class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Preview {previewLoading ? '· refreshing…' : ''}
				</div>
				{#if previewError}
					<p class="text-xs text-[var(--hud-lime)]">{previewError}</p>
				{:else if previewHtml}
					<div class="prose-hud max-h-[600px] overflow-auto text-sm">
						{@html previewHtml}
					</div>
				{:else}
					<p class="text-xs text-[var(--hud-dim)]">
						Start typing to see your article rendered here.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<ImagePicker bind:open={pickerOpen} onPick={onLibraryPick} />

<style>
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 28px;
		padding: 0 8px;
		border-radius: 2px;
		background: var(--hud-inset);
		color: var(--hud-text);
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
		transition:
			background 120ms,
			color 120ms;
	}
	.tb-btn:hover {
		background: var(--hud-panel-mid);
		color: var(--hud-teal);
	}
	.tb-btn-active {
		background: var(--hud-panel-mid);
		color: var(--hud-teal);
	}
	.tb-sep {
		display: inline-block;
		width: 1px;
		height: 20px;
		background: var(--hud-variant);
		margin: 0 4px;
	}
</style>

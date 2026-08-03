<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	type EventRecord = {
		id: string;
		title: string;
		description: string;
		location: string | null;
		url: string | null;
		starts_at: string;
		ends_at: string | null;
		status: string;
		review_notes: string | null;
	};

	let {
		events,
		editEvent = null,
		role,
		eventsEnabled
	}: {
		events: EventRecord[];
		editEvent?: EventRecord | null;
		role: 'user' | 'contributor' | 'admin';
		eventsEnabled: boolean;
	} = $props();

	const isElevated = $derived(role === 'contributor' || role === 'admin');

	const STATUS_CLASS: Record<string, string> = {
		pending: 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]',
		approved: 'bg-[var(--hud-teal)] text-[var(--hud-on-teal)]',
		rejected: 'bg-[var(--hud-enemy)]/15 text-[var(--hud-enemy)]'
	};

	/** ISO timestamp → datetime-local input value in the viewer's timezone. */
	function toLocalInputValue(iso: string): string {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	// An ?editEvent deep link (from the public calendar) prefills the form once
	// on load; later data refreshes (e.g. after saving) must not re-prefill it.
	// svelte-ignore state_referenced_locally
	const initialEdit = editEvent;

	let editingId = $state<string | null>(initialEdit?.id ?? null);
	let editingStatus = $state<string | null>(initialEdit?.status ?? null);
	let title = $state(initialEdit?.title ?? '');
	let description = $state(initialEdit?.description ?? '');
	let location = $state(initialEdit?.location ?? '');
	let url = $state(initialEdit?.url ?? '');
	let startsAt = $state(initialEdit ? toLocalInputValue(initialEdit.starts_at) : '');
	let endsAt = $state(initialEdit?.ends_at ? toLocalInputValue(initialEdit.ends_at) : '');

	let submitting = $state(false);
	let formError = $state('');
	let formSuccess = $state('');
	let busyId = $state<string | null>(null);
	let actionError = $state('');

	// The form stays collapsed behind "Create New Event" unless a deep-linked
	// edit opened the panel with a prefilled event.
	let formOpen = $state(Boolean(initialEdit));

	function openCreate() {
		clearForm();
		formError = '';
		formSuccess = '';
		formOpen = true;
	}

	function clearForm() {
		title = '';
		description = '';
		location = '';
		url = '';
		startsAt = '';
		endsAt = '';
		editingId = null;
		editingStatus = null;
	}

	function startEdit(event: EventRecord) {
		editingId = event.id;
		editingStatus = event.status;
		title = event.title;
		description = event.description ?? '';
		location = event.location ?? '';
		url = event.url ?? '';
		startsAt = toLocalInputValue(event.starts_at);
		endsAt = event.ends_at ? toLocalInputValue(event.ends_at) : '';
		formError = '';
		formSuccess = '';
		formOpen = true;
		requestAnimationFrame(() => {
			document
				.getElementById('community-events')
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	function cancelForm() {
		clearForm();
		formError = '';
		formOpen = false;
	}

	async function submitEvent(e: SubmitEvent) {
		e.preventDefault();
		if (submitting) return;
		submitting = true;
		formError = '';
		formSuccess = '';
		const wasEditingApproved = editingStatus === 'approved';
		try {
			const res = await fetch(
				editingId ? `/api/community/events/${editingId}` : '/api/community/events',
				{
					method: editingId ? 'PATCH' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						title,
						description: description || null,
						location: location || null,
						url: url || null,
						startsAt: new Date(startsAt).toISOString(),
						endsAt: endsAt ? new Date(endsAt).toISOString() : null
					})
				}
			);
			if (!res.ok) {
				formError = await res.text();
				return;
			}
			const wasEditing = editingId !== null;
			clearForm();
			formOpen = false;
			if (wasEditing) {
				formSuccess = isElevated
					? 'Event updated.'
					: wasEditingApproved
						? 'Changes saved — the event returns to the calendar once re-approved.'
						: 'Changes saved — your event is awaiting review.';
			} else {
				formSuccess = isElevated
					? 'Event published.'
					: 'Event submitted — it will appear once a reviewer approves it.';
			}
			await invalidateAll();
		} catch (err) {
			formError = err instanceof Error ? err.message : 'Could not submit the event.';
		} finally {
			submitting = false;
		}
	}

	async function withdrawEvent(event: EventRecord) {
		if (busyId) return;
		if (!confirm(`Withdraw "${event.title}"?`)) return;
		busyId = event.id;
		actionError = '';
		try {
			const res = await fetch(`/api/community/events/${event.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) {
				actionError = await res.text();
				return;
			}
			if (editingId === event.id) clearForm();
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not withdraw the event.';
		} finally {
			busyId = null;
		}
	}

	function formatWhen(startsIso: string, endsIso: string | null): string {
		const starts = new Date(startsIso);
		const dateOpts: Intl.DateTimeFormatOptions = {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		};
		const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
		const timeTzOpts: Intl.DateTimeFormatOptions = { ...timeOpts, timeZoneName: 'short' };
		const startDate = starts.toLocaleDateString(undefined, dateOpts);
		if (!endsIso) return `${startDate} · ${starts.toLocaleTimeString(undefined, timeTzOpts)}`;
		const ends = new Date(endsIso);
		const sameDay = starts.toDateString() === ends.toDateString();
		return sameDay
			? `${startDate} · ${starts.toLocaleTimeString(undefined, timeOpts)} – ${ends.toLocaleTimeString(undefined, timeTzOpts)}`
			: `${startDate} · ${starts.toLocaleTimeString(undefined, timeOpts)} → ${ends.toLocaleDateString(undefined, dateOpts)} · ${ends.toLocaleTimeString(undefined, timeTzOpts)}`;
	}
</script>

<div class="mt-6 hud-panel p-8" id="community-events">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="hud-eyebrow tracking-[0.3em]">Ops Calendar</p>
			<h2
				class="mt-4 font-[var(--font-display)] text-3xl font-bold uppercase text-[var(--hud-text)]"
			>
				My Events
			</h2>
			<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
				{#if isElevated}
					Events you post go live on the community calendar immediately. You can also edit any
					listed event from the calendar.
				{:else}
					Submit tournaments, custom lobbies, and meetups for the community calendar. A
					reviewer approves each event before it appears; editing an approved event sends it
					back through review.
				{/if}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if eventsEnabled && !formOpen}
				<button type="button" onclick={openCreate} class="hud-cta px-4 py-2 text-sm">
					Create New Event
				</button>
			{/if}
			<a href="/community/events" class="hud-cta-ghost px-4 py-2 text-sm">View Calendar</a>
		</div>
	</div>

	{#if !eventsEnabled}
		<p class="mt-6 text-sm text-[var(--hud-muted)]">
			Events are unavailable — this deployment is running without a database.
		</p>
	{:else}
		{#if formSuccess && !formOpen}
			<p class="mt-6 rounded-sm bg-[var(--hud-teal)]/10 p-3 text-sm text-[var(--hud-teal)]">
				{formSuccess}
			</p>
		{/if}

		{#if formOpen}
		<form
			onsubmit={submitEvent}
			class="mt-6 rounded-sm bg-[var(--hud-panel-mid)] p-6"
		>
			<div
				class="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				{editingId ? 'Edit event' : isElevated ? 'Post an event' : 'Submit an event'}
				{#if !isElevated}
					<span class="ml-2 font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
						{editingId && editingStatus === 'approved'
							? 'saving sends it back through review'
							: 'reviewed before publishing'}
					</span>
				{/if}
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<label class="flex flex-col gap-1 md:col-span-2">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Title
					</span>
					<input
						type="text"
						bind:value={title}
						required
						minlength="3"
						maxlength="140"
						placeholder="e.g. Friday Night Custom Lobby"
						class="hud-input rounded-sm px-3 py-2 text-sm"
					/>
				</label>

				<label class="flex flex-col gap-1 md:col-span-2">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Description
					</span>
					<textarea
						bind:value={description}
						rows="3"
						maxlength="2000"
						placeholder="What's happening, who can join, how to sign up…"
						class="hud-input rounded-sm px-3 py-2 text-sm"
					></textarea>
				</label>

				<label class="flex flex-col gap-1">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Location <span class="normal-case tracking-normal">(optional)</span>
					</span>
					<input
						type="text"
						bind:value={location}
						maxlength="120"
						placeholder="e.g. EU servers, Official Discord"
						class="hud-input rounded-sm px-3 py-2 text-sm"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Link <span class="normal-case tracking-normal">(optional, https)</span>
					</span>
					<input
						type="url"
						bind:value={url}
						maxlength="1024"
						placeholder="https://discord.gg/…"
						class="hud-input rounded-sm px-3 py-2 text-sm"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Starts <span class="normal-case tracking-normal">(your local time)</span>
					</span>
					<input
						type="datetime-local"
						bind:value={startsAt}
						required
						class="hud-input rounded-sm px-3 py-2 text-sm"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span
						class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
					>
						Ends <span class="normal-case tracking-normal">(optional)</span>
					</span>
					<input
						type="datetime-local"
						bind:value={endsAt}
						class="hud-input rounded-sm px-3 py-2 text-sm"
					/>
				</label>
			</div>

			{#if formError}
				<p class="mt-4 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
					{formError}
				</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center gap-2">
				<button
					type="submit"
					disabled={submitting}
					class="hud-cta-outline px-5 py-2 text-xs disabled:opacity-50"
				>
					{submitting
						? 'Saving…'
						: editingId
							? isElevated
								? 'Save changes'
								: 'Save & resubmit'
							: isElevated
								? 'Publish event'
								: 'Submit for review'}
				</button>
				<button type="button" onclick={cancelForm} class="hud-cta-ghost px-4 py-2 text-xs">
					Cancel
				</button>
			</div>
		</form>
		{/if}

		{#if actionError}
			<p class="mt-4 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
				{actionError}
			</p>
		{/if}

		{#if events.length > 0}
			<div class="mt-6">
				<p
					class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Your events ({events.length})
				</p>
				<ul class="mt-3 flex flex-col gap-3">
					{#each events as event (event.id)}
						<li class="rounded-sm bg-[var(--hud-panel-mid)] p-4">
							<div class="flex flex-wrap items-center gap-3">
								<span
									class="rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {STATUS_CLASS[event.status] ?? ''}"
								>
									{event.status}
								</span>
								<span class="text-sm font-semibold text-[var(--hud-text)]">{event.title}</span>
								<span
									class="font-mono text-xs uppercase tracking-[0.08em] text-[var(--hud-muted)]"
								>
									{formatWhen(event.starts_at, event.ends_at)}
								</span>
								<button
									type="button"
									onclick={() => startEdit(event)}
									class="hud-cta-ghost ml-auto px-3 py-1 text-[10px]"
								>
									Edit
								</button>
								{#if event.status === 'pending'}
									<button
										type="button"
										disabled={busyId === event.id}
										onclick={() => withdrawEvent(event)}
										class="hud-cta-ghost px-3 py-1 text-[10px] disabled:opacity-50"
									>
										Withdraw
									</button>
								{/if}
							</div>
							{#if event.status === 'rejected' && event.review_notes}
								<p class="mt-2 text-xs leading-5 text-[var(--hud-muted)]">
									Reviewer note: {event.review_notes}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>

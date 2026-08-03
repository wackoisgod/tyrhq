<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { spanDayKeys } from '$lib/utils/event-days';
	import MiniCalendar from './MiniCalendar.svelte';

	let { data } = $props();

	const isElevated = $derived(data.role === 'contributor' || data.role === 'admin');

	let busyId = $state<string | null>(null);
	let actionError = $state('');

	async function removeEvent(id: string, confirmText: string) {
		if (busyId) return;
		if (!confirm(confirmText)) return;
		busyId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/community/events/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) {
				actionError = await res.text();
				return;
			}
			await invalidateAll();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not remove the event.';
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
		// The last time in the label carries the viewer's timezone name so it's
		// obvious every listed time is local.
		const timeTzOpts: Intl.DateTimeFormatOptions = { ...timeOpts, timeZoneName: 'short' };
		const startDate = starts.toLocaleDateString(undefined, dateOpts);
		if (!endsIso) return `${startDate} · ${starts.toLocaleTimeString(undefined, timeTzOpts)}`;
		const ends = new Date(endsIso);
		const sameDay = starts.toDateString() === ends.toDateString();
		return sameDay
			? `${startDate} · ${starts.toLocaleTimeString(undefined, timeOpts)} – ${ends.toLocaleTimeString(undefined, timeTzOpts)}`
			: `${startDate} · ${starts.toLocaleTimeString(undefined, timeOpts)} → ${ends.toLocaleDateString(undefined, dateOpts)} · ${ends.toLocaleTimeString(undefined, timeTzOpts)}`;
	}

	const calendarEvents = $derived([
		...data.upcoming.map((event) => ({
			id: event.id,
			starts_at: event.starts_at,
			ends_at: event.ends_at,
			finished: false
		})),
		...data.past.map((event) => ({
			id: event.id,
			starts_at: event.starts_at,
			ends_at: event.ends_at,
			finished: true
		}))
	]);

	let flashDay = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	function selectDay(key: string) {
		flashDay = key;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => {
			flashDay = null;
		}, 2500);
		requestAnimationFrame(() => {
			document
				.querySelector(`[data-days~="${key}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	}

	function onDay(event: { starts_at: string; ends_at: string | null }): boolean {
		return flashDay !== null && spanDayKeys(event.starts_at, event.ends_at).includes(flashDay);
	}

	function isLive(startsIso: string, endsIso: string | null): boolean {
		const now = Date.now();
		return new Date(startsIso).getTime() <= now && (!endsIso || new Date(endsIso).getTime() >= now);
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
	<title>Tyr HQ | Community Events</title>
	<meta
		name="description"
		content="Community-run Tyr events — tournaments, custom lobbies, and meetups. Submit your own event for the calendar."
	/>
</svelte:head>

<section class="mx-auto max-w-4xl px-4 py-8 md:px-6">
	<p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Comms Network // Ops Calendar
	</p>
	<div class="mt-2 flex flex-wrap items-end justify-between gap-3">
		<h1
			class="font-[var(--font-display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--hud-text)]"
		>
			Community Events
		</h1>
		<a
			href={data.signedIn ? '/contribute/events' : '/auth?next=%2Fcontribute%2Fevents'}
			class="hud-cta-outline px-4 py-2 text-xs"
		>
			{data.signedIn ? 'Submit an event' : 'Sign in to submit an event'}
		</a>
	</div>
	<p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--hud-muted)]">
		Tournaments, custom lobbies, and community meetups — run by players, listed in one place.
		Manage your own submissions from
		<a href="/contribute/events" class="text-[var(--hud-teal)] hover:underline">My events</a>.
	</p>

	{#if !data.eventsEnabled}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-8 text-center"
			style="box-shadow: var(--hud-surface-ghost);"
		>
			<p class="text-[var(--hud-muted)]">
				Events are unavailable — this deployment is running without a database.
			</p>
		</div>
	{:else}
		{#if actionError}
			<p class="mt-6 rounded-sm bg-[var(--hud-enemy)]/10 p-3 text-sm text-[var(--hud-enemy)]">
				{actionError}
			</p>
		{/if}

		<!-- Upcoming -->
		<div class="mt-8">
			<div
				class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
			>
				<span>Upcoming &amp; Live</span>
				<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
					{data.upcoming.length} scheduled · times shown in your local timezone
				</span>
			</div>

			<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-start">
				{#if data.upcoming.length === 0}
					<div
						class="rounded-sm bg-[var(--hud-panel)] p-8 text-center"
						style="box-shadow: var(--hud-surface-ghost);"
					>
						<p class="text-[var(--hud-muted)]">
							No events on the calendar yet. Know of one?
							<a href="/contribute/events" class="text-[var(--hud-teal)] hover:underline"
								>Submit it here.</a
							>
						</p>
					</div>
				{:else}
					<div class="flex flex-col gap-4">
					{#each data.upcoming as event (event.id)}
						<div
							class="event-card rounded-sm bg-[var(--hud-panel)] p-6 transition hover:shadow-[inset_2px_0_0_0_var(--hud-teal)]"
							class:event-flash={onDay(event)}
							data-days={spanDayKeys(event.starts_at, event.ends_at).join(' ')}
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<div class="flex flex-wrap items-center gap-3">
								{#if isLive(event.starts_at, event.ends_at)}
									<span
										class="rounded-sm bg-[var(--hud-lime)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--hud-lime)]"
									>
										Live now
									</span>
								{/if}
								<span
									class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{formatWhen(event.starts_at, event.ends_at)}
								</span>
								{#if event.location}
									<span
										class="rounded-sm bg-[var(--hud-inset)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--hud-muted)]"
									>
										{event.location}
									</span>
								{/if}
							</div>
							<h2
								class="mt-2 font-[var(--font-display)] text-xl font-semibold text-[var(--hud-text)]"
							>
								{event.title}
							</h2>
							{#if event.description}
								<p class="mt-2 text-sm leading-6 text-[var(--hud-muted)]">{event.description}</p>
							{/if}
							<div class="mt-3 flex flex-wrap items-center gap-4">
								{#if event.url}
									<a
										href={event.url}
										target="_blank"
										rel="noreferrer"
										class="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--hud-teal)] hover:underline"
									>
										{displayHost(event.url)} ↗
									</a>
								{/if}
								{#if event.submitter_display}
									<span
										class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
									>
										Hosted by {event.submitter_display}
									</span>
								{/if}
								{#if isElevated}
									<a
										href="/contribute/events?edit={event.id}"
										class="hud-cta-ghost ml-auto px-3 py-1 text-[10px]"
									>
										Edit
									</a>
									<button
										type="button"
										disabled={busyId === event.id}
										onclick={() =>
											removeEvent(event.id, `Remove "${event.title}" from the calendar?`)}
										class="hud-cta-ghost px-3 py-1 text-[10px] disabled:opacity-50"
									>
										Remove
									</button>
								{/if}
							</div>
						</div>
					{/each}
					</div>
				{/if}

				<div class="md:sticky md:top-4">
					<MiniCalendar events={calendarEvents} onselectday={selectDay} />
				</div>
			</div>
		</div>

		<!-- Past events -->
		{#if data.past.length > 0}
			<div class="mt-10">
				<div
					class="mb-3 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-dim)]"
				>
					Recently finished
				</div>
				<ul class="flex flex-col gap-2">
					{#each data.past as event (event.id)}
						<li
							class="flex flex-wrap items-center gap-3 rounded-sm bg-[var(--hud-panel)] px-4 py-3 opacity-70"
							class:event-flash={onDay(event)}
							data-days={spanDayKeys(event.starts_at, event.ends_at).join(' ')}
							style="box-shadow: var(--hud-surface-ghost);"
						>
							<span
								class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
							>
								{formatWhen(event.starts_at, event.ends_at)}
							</span>
							<span class="text-sm text-[var(--hud-muted)]">{event.title}</span>
							{#if event.submitter_display}
								<span
									class="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
								>
									{event.submitter_display}
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>

<style>
	.event-flash {
		outline: 1px solid var(--hud-teal);
		outline-offset: 2px;
	}
</style>

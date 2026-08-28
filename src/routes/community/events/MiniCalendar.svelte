<script lang="ts">
	import { dayKey, spanDayKeys } from '$lib/utils/event-days';

	type CalendarEvent = {
		id: string;
		starts_at: string;
		ends_at: string | null;
		finished: boolean;
	};

	let {
		events,
		onselectday
	}: {
		events: CalendarEvent[];
		onselectday: (key: string) => void;
	} = $props();

	const today = new Date();
	let viewYear = $state(today.getFullYear());
	let viewMonth = $state(today.getMonth());

	const todayKey = dayKey(today);

	// dayKey -> whether that day has any upcoming/live event (vs only finished)
	const eventDays = $derived.by(() => {
		const map = new Map<string, { active: boolean }>();
		for (const event of events) {
			for (const key of spanDayKeys(event.starts_at, event.ends_at)) {
				const entry = map.get(key) ?? { active: false };
				if (!event.finished) entry.active = true;
				map.set(key, entry);
			}
		}
		return map;
	});

	const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

	type Cell = { day: number; key: string } | null;

	const cells = $derived.by(() => {
		const first = new Date(viewYear, viewMonth, 1);
		const mondayOffset = (first.getDay() + 6) % 7;
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const grid: Cell[] = Array.from({ length: mondayOffset }, () => null);
		for (let day = 1; day <= daysInMonth; day++) {
			grid.push({ day, key: dayKey(new Date(viewYear, viewMonth, day)) });
		}
		while (grid.length % 7 !== 0) grid.push(null);
		return grid;
	});

	const monthLabel = $derived(
		new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric'
		})
	);

	function shiftMonth(delta: number) {
		const next = new Date(viewYear, viewMonth + delta, 1);
		viewYear = next.getFullYear();
		viewMonth = next.getMonth();
	}

	function goToday() {
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
	}
</script>

<div class="rounded-sm bg-[var(--hud-panel)] p-4" style="box-shadow: var(--hud-surface-ghost);">
	<div class="flex items-center justify-between gap-2">
		<button
			type="button"
			onclick={() => shiftMonth(-1)}
			class="hud-cta-ghost px-2 py-1 text-xs"
			aria-label="Previous month"
		>
			‹
		</button>
		<button
			type="button"
			onclick={goToday}
			class="font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.08em] text-[var(--hud-text)] transition hover:text-[var(--hud-teal)]"
			title="Jump to the current month"
		>
			{monthLabel}
		</button>
		<button
			type="button"
			onclick={() => shiftMonth(1)}
			class="hud-cta-ghost px-2 py-1 text-xs"
			aria-label="Next month"
		>
			›
		</button>
	</div>

	<div class="mt-3 grid grid-cols-7 gap-px">
		{#each WEEKDAYS as weekday}
			<div
				class="pb-1 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--hud-dim)]"
			>
				{weekday}
			</div>
		{/each}
		{#each cells as cell, index (index)}
			{#if cell === null}
				<div></div>
			{:else}
				{@const marker = eventDays.get(cell.key)}
				<button
					type="button"
					disabled={!marker}
					onclick={() => onselectday(cell.key)}
					aria-label={marker
						? `Show events on ${cell.key}`
						: undefined}
					class="flex aspect-square flex-col items-center justify-center rounded-sm text-xs transition
						{cell.key === todayKey
						? 'bg-[var(--hud-inset)] text-[var(--hud-teal)]'
						: 'text-[var(--hud-muted)]'}
						{marker ? 'cursor-pointer font-semibold text-[var(--hud-text)] hover:bg-[var(--hud-inset)] hover:text-[var(--hud-teal)]' : ''}"
				>
					<span>{cell.day}</span>
					<span
						class="mt-0.5 h-1 w-1 rounded-full
							{marker ? (marker.active ? 'bg-[var(--hud-teal)]' : 'bg-[var(--hud-dim)]') : 'bg-transparent'}"
					></span>
				</button>
			{/if}
		{/each}
	</div>

	<div class="mt-3 flex items-center gap-4 border-t border-[var(--hud-variant)]/50 pt-2">
		<span class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--hud-dim)]">
			<span class="h-1 w-1 rounded-full bg-[var(--hud-teal)]"></span> Upcoming
		</span>
		<span class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--hud-dim)]">
			<span class="h-1 w-1 rounded-full bg-[var(--hud-dim)]"></span> Finished
		</span>
	</div>
</div>

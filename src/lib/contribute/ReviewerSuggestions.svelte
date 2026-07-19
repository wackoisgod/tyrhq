<script lang="ts">
	import {
		computeBodySuggestionSegments,
		countChangeSegments,
		mergeSuggestions,
		type SuggestionDecision
	} from './body-suggestions';

	let {
		base,
		proposed,
		onApply,
		busy = false
	}: {
		/** The body the author submitted — the diff base. */
		base: string;
		/** The reviewer's proposed body. */
		proposed: string;
		/** Called with the merged markdown once the author applies their decisions. */
		onApply: (merged: string) => void;
		busy?: boolean;
	} = $props();

	const segments = $derived(computeBodySuggestionSegments(base, proposed));
	const totalChanges = $derived(countChangeSegments(segments));

	let decisions = $state<Record<number, SuggestionDecision>>({});

	function decisionFor(id: number): SuggestionDecision {
		return decisions[id] ?? 'pending';
	}

	const resolvedCount = $derived(
		Array.from({ length: totalChanges }, (_, id) => id).filter((id) => decisionFor(id) !== 'pending')
			.length
	);
	const merged = $derived(mergeSuggestions(segments, decisions));

	function setDecision(id: number, decision: SuggestionDecision) {
		// Clicking the active choice again clears it back to pending.
		decisions = { ...decisions, [id]: decisionFor(id) === decision ? 'pending' : decision };
	}

	function setAll(decision: SuggestionDecision) {
		const next: Record<number, SuggestionDecision> = {};
		for (let id = 0; id < totalChanges; id++) next[id] = decision;
		decisions = next;
	}
</script>

<div class="rounded-sm border-l-2 border-[var(--hud-teal)] bg-[var(--hud-teal)]/10 p-4">
	<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">
		Reviewer suggested edits
	</div>
	<p class="mt-1 text-sm text-[var(--hud-text)]">
		A reviewer proposed {totalChanges} change{totalChanges === 1 ? '' : 's'} to your body. Accept the
		ones you like and reject the rest, then apply them to your draft.
	</p>

	<div class="susp-body mt-3"><!--
		-->{#each segments as seg, i (i)}{#if seg.kind === 'same'}{seg.value}{:else}{@const d =
					decisionFor(seg.id)}<span
					class="susp-change"
					class:is-accepted={d === 'accepted'}
					class:is-rejected={d === 'rejected'}
					>{#if seg.before}<span class="susp-del">{seg.before}</span>{/if}{#if seg.after}<span
							class="susp-add">{seg.after}</span
						>{/if}<span class="susp-controls"
						><button
							type="button"
							class="susp-btn susp-accept"
							class:active={d === 'accepted'}
							title="Use the reviewer's version"
							onclick={() => setDecision(seg.id, 'accepted')}>✓</button
						><button
							type="button"
							class="susp-btn susp-reject"
							class:active={d === 'rejected'}
							title="Keep your version"
							onclick={() => setDecision(seg.id, 'rejected')}>✗</button
						></span
					></span
				>{/if}{/each}</div>

	<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
		<div class="text-xs text-[var(--hud-muted)]">
			{resolvedCount} of {totalChanges} resolved
			{#if resolvedCount < totalChanges}
				· unresolved edits keep your wording
			{/if}
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="button" class="hud-cta-ghost px-3 py-1.5 text-xs" onclick={() => setAll('rejected')}>
				Reject all
			</button>
			<button type="button" class="hud-cta-outline px-3 py-1.5 text-xs" onclick={() => setAll('accepted')}>
				Accept all
			</button>
			<button
				type="button"
				class="hud-cta px-4 py-1.5 text-xs disabled:opacity-50"
				disabled={busy}
				onclick={() => onApply(merged)}
			>
				Apply to draft
			</button>
		</div>
	</div>
</div>

<style>
	.susp-body {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.8125rem;
		line-height: 1.95;
		color: var(--hud-muted);
		white-space: pre-wrap;
		word-wrap: break-word;
		max-height: 60vh;
		overflow-y: auto;
		border-radius: 2px;
		background: var(--hud-inset);
		padding: 0.75rem;
	}

	.susp-change {
		white-space: nowrap;
	}

	.susp-del {
		background: rgba(255, 92, 122, 0.16);
		color: #ffb0bf;
		text-decoration: line-through;
		text-decoration-color: rgba(255, 92, 122, 0.7);
		border-radius: 1px;
		padding: 0 1px;
	}
	.susp-add {
		background: rgba(98, 232, 132, 0.18);
		color: #b8ffce;
		box-shadow: inset 0 -1px 0 0 rgba(98, 232, 132, 0.6);
		border-radius: 1px;
		padding: 0 1px;
	}
	.susp-change.is-accepted .susp-del {
		opacity: 0.35;
	}
	.susp-change.is-rejected .susp-add {
		opacity: 0.3;
	}

	.susp-controls {
		display: inline-flex;
		gap: 2px;
		margin: 0 2px;
		vertical-align: middle;
	}
	.susp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 2px;
		background: var(--hud-panel-mid);
		color: var(--hud-dim);
		font-size: 11px;
		line-height: 1;
		transition: background 120ms, color 120ms;
	}
	.susp-accept:hover,
	.susp-accept.active {
		background: rgba(98, 232, 132, 0.25);
		color: #b8ffce;
	}
	.susp-reject:hover,
	.susp-reject.active {
		background: rgba(255, 92, 122, 0.22);
		color: #ffb0bf;
	}
</style>

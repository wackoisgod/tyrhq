<script lang="ts">
	import FallbackImage from '$lib/components/FallbackImage.svelte';
	import { getAbsoluteUrl } from '$lib/site-url';
	import {
		canIncrementTalentPoint,
		computeBuild,
		createPlannerCatalog,
		descriptionIndicatesStacking,
		formatStatValue,
		getDefaultSelection,
		getDeltaTone,
		getPlannerTalentsForVehicle,
		getPointsSpentInTiersBelow,
		getTalentTierUnlockRequirement,
		groupStatCards,
		isConditionalComponent,
		isConditionalTalent,
		MAX_TOTAL_TALENT_POINTS,
		talentPrerequisitesSatisfied,
		TALENT_POINTS_REQUIRED_PER_TIER_STEP
	} from '$lib/game-engine/build';
	import {
		fillComponentDescription,
		formatComponentCategory,
		plainComponentDescription
	} from '$lib/game-engine/component-format';

	import { onMount } from 'svelte';

	const DRAFT_KEY = 'tyr-planner-draft';

	let { data } = $props();

	const catalog = $derived.by(() => createPlannerCatalog(data.bundle));
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state<string | null>(null);
	let copyLinkLabel = $state('Copy Share Link');
	let buildName = $state('');
	let exporting = $state(false);
	let exportError = $state<string | null>(null);
	let exportCode = $state('');
	let exportModalOpen = $state(false);
	let copyExportCodeLabel = $state('Copy Export Code');

	// Star state — overrides track optimistic updates, reset when underlying data changes
	let starredOverride = $state<boolean | null>(null);
	let starCountOverride = $state<number | null>(null);
	let starring = $state(false);
	const starred = $derived(starredOverride ?? (data.userHasStarred ?? false));
	const starCount = $derived(starCountOverride ?? (data.loadedBuild?.star_count ?? 0));

	/** When editing an existing build, holds its metadata */
	let editingBuild = $state<{ id: string; slug: string; title: string; isPublic: boolean } | null>(
		null
	);

	// Initialize editingBuild from loaded build data
	$effect(() => {
		if (data.loadedBuild && !editingBuild) {
			editingBuild = {
				id: data.loadedBuild.id,
				slug: data.loadedBuild.slug,
				title: data.loadedBuild.title,
				isPublic: data.loadedBuild.is_public
			};
			buildName = data.loadedBuild.title;
		}
	});

	async function toggleStar() {
		if (!data.user || !data.loadedBuild || starring) return;
		starring = true;
		// Optimistic update
		const prevStarred = starred;
		const prevCount = starCount;
		starredOverride = !prevStarred;
		starCountOverride = prevCount + (starredOverride ? 1 : -1);
		try {
			const res = await fetch('/api/builds/stars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ buildId: data.loadedBuild.id })
			});
			if (res.ok) {
				const result = await res.json();
				starredOverride = result.starred;
				starCountOverride = result.starCount;
			} else {
				// Revert optimistic update
				starredOverride = prevStarred;
				starCountOverride = prevCount;
			}
		} catch {
			// Revert optimistic update
			starredOverride = prevStarred;
			starCountOverride = prevCount;
		} finally {
			starring = false;
		}
	}

	async function saveBuild(isPublic: boolean) {
		if (!selection || !data.user) return;
		saving = true;
		saveError = null;
		saveSuccess = null;
		try {
			const isUpdate = editingBuild !== null;
			const title = buildName.trim() || `${currentVehicle.name} Build`;
			const res = await fetch('/api/builds', {
				method: isUpdate ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(isUpdate ? { id: editingBuild!.id } : {}),
					title,
					vehicleId: selection.vehicleId,
					selection,
					isPublic
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: 'Save failed' }));
				saveError = body.message ?? 'Save failed';
				return;
			}
			const build = await res.json();
			// Update editing state to reflect saved build
			editingBuild = {
				id: build.id,
				slug: build.slug,
				title: build.title,
				isPublic: build.is_public
			};
			buildName = build.title;
			clearDraft();
			saveSuccess = isPublic
				? `Build shared! Link: /builds/${build.slug}`
				: isUpdate
					? 'Build updated.'
					: 'Build saved to your account.';
		} catch {
			saveError = 'Network error — could not save build.';
		} finally {
			saving = false;
		}
	}

	async function saveAsNew() {
		if (!selection || !data.user) return;
		// Reset editing state so it creates a new build
		editingBuild = null;
		await saveBuild(false);
	}

	function closeExportModal() {
		exportModalOpen = false;
		copyExportCodeLabel = 'Copy Export Code';
	}

	async function copyExportCode() {
		if (!exportCode) return;

		try {
			await navigator.clipboard.writeText(exportCode);
			copyExportCodeLabel = 'Copied!';
			setTimeout(() => {
				if (exportModalOpen) copyExportCodeLabel = 'Copy Export Code';
			}, 2000);
		} catch {
			copyExportCodeLabel = 'Copy failed';
			setTimeout(() => {
				if (exportModalOpen) copyExportCodeLabel = 'Copy Export Code';
			}, 2000);
		}
	}

	async function exportBuild() {
		if (!selection) return;

		exporting = true;
		exportError = null;

		try {
			const res = await fetch('/api/builds/export', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: buildName.trim() || `${currentVehicle.name} Build`,
					vehicleId: selection.vehicleId,
					selection
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: 'Export failed' }));
				exportError = body.message ?? 'Export failed';
				return;
			}

			const body = await res.json();
			exportCode = body.shareCode ?? '';
			copyExportCodeLabel = 'Copy Export Code';
			exportModalOpen = true;
		} catch {
			exportError = 'Network error — could not export build.';
		} finally {
			exporting = false;
		}
	}

	function newBuild() {
		editingBuild = null;
		buildName = '';
		clearDraft();
		selection = getDefaultSelection(catalog);
		saveError = null;
		saveSuccess = null;
		exportError = null;
		exportCode = '';
		exportModalOpen = false;
	}

	// --- localStorage draft persistence ---
	let draftRestored = $state(false);
	let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

	function saveDraft() {
		if (!selection || editingBuild) return;
		try {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(selection));
		} catch {}
	}

	function clearDraft() {
		try {
			localStorage.removeItem(DRAFT_KEY);
		} catch {}
	}

	function restoreDraft(): ReturnType<typeof getDefaultSelection> | null {
		try {
			const raw = localStorage.getItem(DRAFT_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (parsed && parsed.vehicleId && Array.isArray(parsed.ammoIds)) return parsed;
		} catch {}
		return null;
	}

	function normalizeAmmoSelection(nextSelection: ReturnType<typeof getDefaultSelection>) {
		const defaults = getDefaultSelection(catalog, nextSelection.vehicleId);
		return defaults.ammoIds.map((fallbackAmmoId, slotIndex) => {
			const ammoId = nextSelection.ammoIds[slotIndex] ?? fallbackAmmoId;
			const ammo = catalog.ammoById.get(ammoId);
			if (!ammo) return fallbackAmmoId;
			if (slotIndex === 1 && ammo.id !== 'standard' && !ammo.canLoadSecondary) {
				return fallbackAmmoId;
			}
			return ammo.id;
		});
	}

	// Debounced auto-save to localStorage
	$effect(() => {
		if (!selection || !draftRestored || editingBuild) return;
		// Access selection fields to track changes
		void [selection.vehicleId, selection.ammoIds, selection.componentIds, selection.talentPoints];
		if (draftSaveTimer) clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(saveDraft, 500);
	});

	let selection = $state<ReturnType<typeof getDefaultSelection> | null>(null);
	let includeConditionalEffects = $state(true);
	let assumeMaxStacks = $state(false);
	/** Which component slot's browse modal is open, or null */
	let componentModalSlot = $state<number | null>(null);

	/** Compute all prerequisite connection data for rendering grid connectors */
	const prereqConnectors = $derived.by(() => {
		if (!selection) return [];
		return talentNodes.flatMap((node) =>
			node.prerequisiteIds
				.map((prereqId) => {
					const prereqNode = talentNodes.find((n) => n.talent.id === prereqId);
					if (!prereqNode) return null;
					const fromPts = getTalentPoints(prereqId);
					const fromMaxPts = prereqNode.maxPoints;
					const toPts = getTalentPoints(node.talent.id);
					// Determine direction: horizontal (different tier) or vertical (different row)
					const horizontal = prereqNode.tier !== node.tier;
					const minCol = Math.min(prereqNode.tier, node.tier);
					const maxCol = Math.max(prereqNode.tier, node.tier);
					const minRow = Math.min(prereqNode.row, node.row);
					const maxRow = Math.max(prereqNode.row, node.row);
					return { fromPts, fromMaxPts, toPts, horizontal, minCol, maxCol, minRow, maxRow };
				})
				.filter(Boolean)
		) as Array<{
			fromPts: number;
			fromMaxPts: number;
			toPts: number;
			horizontal: boolean;
			minCol: number;
			maxCol: number;
			minRow: number;
			maxRow: number;
		}>;
	});
	let componentSearchQuery = $state('');
	/** Which ammo slot's browse modal is open, or null */
	let ammoModalSlot = $state<number | null>(null);
	const isVehicleLocked = $derived(Boolean(data.lockedVehicleId));

	$effect(() => {
		if (typeof document === 'undefined') return;
		if (ammoModalSlot !== null) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		if (componentModalSlot !== null) {
			const previousOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previousOverflow;
			};
		}
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		if (exportModalOpen) {
			const previousOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previousOverflow;
			};
		}
	});

	onMount(() => {
		draftRestored = true;
	});

	$effect(() => {
		if (!selection) {
			// Priority: loaded build > localStorage draft > default
			if (data.loadedBuild?.selection) {
				selection = data.loadedBuild.selection as ReturnType<typeof getDefaultSelection>;
			} else if (!data.initialVehicleId && draftRestored) {
				const draft = restoreDraft();
				if (draft) {
					selection = draft;
					return;
				}
			}
			if (!selection) {
				selection = getDefaultSelection(catalog, data.initialVehicleId ?? undefined);
			}
		}
	});

	/** Ensure at most one copy of each component across slots (fixes legacy / bad state). */
	$effect(() => {
		if (!selection) return;
		const seen = new Set<string>();
		let changed = false;
		const next = selection.componentIds.map((id) => {
			if (!id) return '';
			if (seen.has(id)) {
				changed = true;
				return '';
			}
			seen.add(id);
			return id;
		});
		if (changed) selection.componentIds = next;
	});

	$effect(() => {
		if (!selection) return;
		const currentSelection = selection;
		const normalizedAmmoIds = normalizeAmmoSelection(currentSelection);
		const previewAmmoSlot = Math.min(
			currentSelection.previewAmmoSlot,
			Math.max(0, normalizedAmmoIds.length - 1)
		);
		const ammoChanged = normalizedAmmoIds.some(
			(ammoId, index) => ammoId !== currentSelection.ammoIds[index]
		);
		if (ammoChanged) selection.ammoIds = normalizedAmmoIds;
		if (previewAmmoSlot !== currentSelection.previewAmmoSlot) selection.previewAmmoSlot = previewAmmoSlot;
	});

	const currentVehicle = $derived(
		selection ? (catalog.vehicleById.get(selection.vehicleId) ?? catalog.vehicles[0]) : catalog.vehicles[0]
	);
	const talentNodes = $derived(selection ? getPlannerTalentsForVehicle(catalog, selection.vehicleId) : []);
	const talentGridDims = $derived.by(() => {
		if (!talentNodes.length) return { cols: 1, rows: 1 };
		let maxTier = 0;
		let maxRow = 0;
		for (const node of talentNodes) {
			maxTier = Math.max(maxTier, node.tier);
			maxRow = Math.max(maxRow, node.row);
		}
		return { cols: maxTier + 1, rows: maxRow + 1 };
	});

	const groupedComponents = $derived.by(() => {
		const grouped = new Map<string, typeof catalog.components>();
		for (const component of catalog.components) {
			const items = grouped.get(component.category) ?? [];
			items.push(component);
			grouped.set(component.category, items);
		}
		return [...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0]));
	});
	const groupedVehicles = $derived.by(() => {
		const grouped = new Map<string, typeof catalog.vehicles>();
		for (const vehicle of catalog.vehicles) {
			const items = grouped.get(vehicle.classLabel) ?? [];
			items.push(vehicle);
			grouped.set(vehicle.classLabel, items);
		}
		return [...grouped.entries()]
			.sort((left, right) => left[0].localeCompare(right[0]))
			.map(([group, items]) => [group, items.sort((left, right) => left.name.localeCompare(right.name))] as const);
	});

	const nativeComponentIds = $derived(
		new Set(currentVehicle.nativeComponents.map((nc) => nc.componentId))
	);

	const computedBuild = $derived(
		selection
			? computeBuild(catalog, selection, {
					includeConditionalEffects,
					assumeMaxStacks
				})
			: null
	);

	const buildHasConditionals = $derived.by(() => {
		if (!selection) return false;
		for (const id of selection.componentIds) {
			if (!id) continue;
			const c = catalog.componentById.get(id);
			if (c && isConditionalComponent(c)) return true;
		}
		for (const [talentId, pts] of Object.entries(selection.talentPoints)) {
			if (pts <= 0) continue;
			const node = talentNodes.find((n) => n.talent.id === talentId);
			if (node && isConditionalTalent(node.talent)) return true;
		}
		return false;
	});

	const buildHasStacking = $derived.by(() => {
		if (!selection) return false;
		for (const id of selection.componentIds) {
			if (!id) continue;
			const c = catalog.componentById.get(id);
			if (c && descriptionIndicatesStacking(c.description)) return true;
		}
		for (const [talentId, pts] of Object.entries(selection.talentPoints)) {
			if (pts <= 0) continue;
			const node = talentNodes.find((n) => n.talent.id === talentId);
			if (node && descriptionIndicatesStacking(node.talent.description)) return true;
		}
		return false;
	});

	const groupedStats = $derived(computedBuild ? groupStatCards(computedBuild.statCards) : []);
	let activeStatGroup = $state('');

	$effect(() => {
		const names = groupedStats.map(([group]) => group);
		if (!names.length) return;
		if (!names.includes(activeStatGroup)) activeStatGroup = names[0];
	});

	const activeGroupCards = $derived.by(() => {
		const row = groupedStats.find(([group]) => group === activeStatGroup);
		return row ? row[1] : [];
	});

	/** Expanded stat breakdown "Sources" rows (keyed by stat definition key). */
	let statSourcesExpanded = $state<Record<string, boolean>>({});

	function toggleStatSources(statKey: string) {
		statSourcesExpanded = { ...statSourcesExpanded, [statKey]: !statSourcesExpanded[statKey] };
	}

	let statSourcesVehicleId = $state<string | null>(null);
	$effect(() => {
		const vid = selection?.vehicleId ?? null;
		if (vid !== statSourcesVehicleId) {
			statSourcesVehicleId = vid;
			statSourcesExpanded = {};
		}
	});

	const spentTalentPoints = $derived(
		selection ? Object.values(selection.talentPoints).reduce((total, value) => total + value, 0) : 0
	);
	const summaryCards = $derived(
		computedBuild
			? [
					{ label: 'Health', value: formatStatValue(computedBuild.stats.MaxHealth ?? 0) },
					{
						label: 'Damage',
						value: formatStatValue(computedBuild.stats.ShellDamage ?? 0)
					},
					{
						label: 'Top Speed',
						value: formatStatValue(computedBuild.stats.MaxSpeed ?? 0, 'kph')
					},
					{
						label: 'Ability CD',
						value: formatStatValue(computedBuild.stats.AbilityCooldown ?? 0, 's')
					}
				]
			: []
	);

	function closeComponentModal() {
		componentModalSlot = null;
		componentSearchQuery = '';
	}

	function closeAmmoModal() {
		ammoModalSlot = null;
	}

	function resetForVehicle(vehicleId: string) {
		if (isVehicleLocked) return;
		componentModalSlot = null;
		selection = getDefaultSelection(catalog, vehicleId);
	}

	function setPreviewAmmoSlot(slotIndex: number) {
		if (!selection) return;
		selection.previewAmmoSlot = slotIndex;
	}

	function setAmmo(slotIndex: number, ammoId: string) {
		if (!selection) return;
		selection.ammoIds[slotIndex] = ammoId;
	}

	function formatTalentDescription(
		description: string,
		pointValues: number[],
		currentPoints: number,
		nodeMaxPoints: number
	) {
		const cleaned = plainComponentDescription(description);
		if (!pointValues.length) return cleaned;

		const perPoint = pointValues[0];
		// When unallocated, preview the value at the node's cap — pointValues may extend
		// past the node's maxPoints (e.g. Sonar Max Energy: pointValues=[10,20,30,40,50]
		// but the node only allows 3 points, so the previewed max should be 30, not 50).
		const previewIndex = currentPoints > 0
			? Math.min(currentPoints, pointValues.length)
			: Math.min(nodeMaxPoints, pointValues.length);
		const levelValue = pointValues[Math.max(1, previewIndex) - 1];

		function fmt(n: number) {
			const abs = Math.abs(n);
			if (abs >= 100) return String(Math.round(n));
			if (abs >= 1 && abs === Math.round(abs)) return String(n);
			const s = n.toFixed(2).replace(/\.?0+$/, '');
			return s === '-0' ? '0' : s;
		}

		let count = 0;
		return cleaned.replace(/\bvalue\b/gi, () => {
			count++;
			return fmt(count === 1 ? levelValue : perPoint);
		});
	}

	function otherSlotsComponentIds(slotIndex: number): Set<string> {
		const used = new Set<string>();
		if (!selection) return used;
		selection.componentIds.forEach((id, index) => {
			if (index !== slotIndex && id) used.add(id);
		});
		return used;
	}

	function groupedComponentsForSlot(slotIndex: number, search: string = '') {
		const taken = otherSlotsComponentIds(slotIndex);
		const q = search.trim().toLowerCase();
		return groupedComponents
			.map(
				([category, items]) =>
					[category, items.filter((component) => {
						if (taken.has(component.id)) return false;
						if (q && !component.name.toLowerCase().includes(q) && !plainComponentDescription(component.description).toLowerCase().includes(q) && !component.category.toLowerCase().includes(q)) return false;
						return true;
					})] as const
			)
			.filter(([, items]) => items.length > 0);
	}

	function setComponent(slotIndex: number, componentId: string) {
		if (!selection) return;
		if (componentId) {
			selection.componentIds = selection.componentIds.map((id, index) =>
				index !== slotIndex && id === componentId ? '' : id
			);
		}
		selection.componentIds[slotIndex] = componentId;
	}

	function setTalentPoints(talentId: string, nextValue: number, maxPoints: number) {
		if (!selection) return;
		const nodes = getPlannerTalentsForVehicle(catalog, selection.vehicleId);
		const node = nodes.find((n) => n.talent.id === talentId);
		const prev = selection.talentPoints[talentId] ?? 0;
		const totalSpent = Object.values(selection.talentPoints).reduce((a, b) => a + b, 0);

		if (nextValue < prev) {
			const clamped = Math.max(0, nextValue);
			if (clamped === 0) delete selection.talentPoints[talentId];
			else selection.talentPoints[talentId] = clamped;
			return;
		}

		// TyrPilotBuilderSite: global cap + per-node max + prerequisites + tier unlock
		const maxAllowedByBudget = Math.min(maxPoints, MAX_TOTAL_TALENT_POINTS - totalSpent + prev);
		let target = Math.min(nextValue, maxAllowedByBudget);
		if (target <= prev) return;

		if (node) {
			const prereqOk = talentPrerequisitesSatisfied(node, selection.talentPoints, talentNodes);
			const spentBelow = getPointsSpentInTiersBelow(nodes, selection.talentPoints, node.tier);
			const tierOk = spentBelow >= getTalentTierUnlockRequirement(node.tier);
			if (!prereqOk || !tierOk) return;
		}

		if (target === 0) {
			delete selection.talentPoints[talentId];
			return;
		}
		selection.talentPoints[talentId] = target;
	}

	function getTalentPoints(talentId: string) {
		return selection?.talentPoints[talentId] ?? 0;
	}

	function getPreviewSlotLabel(index: number) {
		if (index === 0) return 'Primary';
		if (index === 1) return 'Secondary';
		if (index === 2) return 'Tertiary';
		return `Ammo Slot ${index}`;
	}

	function getAmmoSlotTitle(index: number) {
		return `${getPreviewSlotLabel(index)} Shell`;
	}

	function resetAllTalentPoints() {
		if (!selection) return;
		selection.talentPoints = {};
	}

	/** Stitch "Industrial Tactical HUD" (Vehicle Builder / Talent Tree screen) */
	function talentTileTone(node: (typeof talentNodes)[number], points: number, ruleLocked: boolean) {
		const shell =
			'rounded-sm ring-1 transition-[box-shadow,background-color,opacity] duration-150';
		// Points invested but prerequisites/tier no longer met — invalid state
		if (points > 0 && ruleLocked) {
			if (node.isKeystone) {
				return `${shell} ring-rose-400/40 bg-rose-950/30 shadow-[inset_4px_0_0_0_rgba(244,63,94,0.6),inset_0_0_0_1px_rgba(244,63,94,0.15)]`;
			}
			return `${shell} ring-rose-400/40 bg-rose-950/30 shadow-[inset_4px_0_0_0_rgba(244,63,94,0.6)]`;
		}
		if (node.isKeystone) {
			const keystoneActive = points > 0
				? ' ring-[var(--hud-lime)]/40 bg-[var(--hud-panel-high)] shadow-[inset_4px_0_0_0_var(--hud-lime),inset_0_0_0_1px_rgba(202,242,0,0.18)]'
				: ' ring-[#454932]/18 bg-[var(--hud-panel-high)] shadow-[inset_4px_0_0_0_var(--hud-lime),inset_0_0_0_1px_rgba(202,242,0,0.12)]';
			const locked = ruleLocked ? ' opacity-50' : ' hover:ring-[var(--hud-teal)]/25';
			return `${shell}${keystoneActive}${locked}`;
		}
		if (points > 0) {
			return `${shell} ring-[var(--hud-teal)]/30 bg-[var(--hud-panel-mid)] shadow-[inset_4px_0_0_0_var(--hud-teal),inset_0_0_0_1px_rgba(102,218,190,0.08)] hover:ring-[var(--hud-teal)]/40`;
		}
		const locked = ruleLocked ? ' opacity-40' : ' hover:ring-[var(--hud-teal)]/25';
		return `${shell} ring-[#454932]/18 bg-[var(--hud-surface)] shadow-[inset_3px_0_0_0_rgba(143,147,120,0.15)]${locked}`;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && componentModalSlot !== null) closeComponentModal();
		if (event.key === 'Escape' && ammoModalSlot !== null) closeAmmoModal();
		if (event.key === 'Escape' && exportModalOpen) closeExportModal();
	}}
/>

<svelte:head>
	<title>Tyr HQ | Build Planner</title>
</svelte:head>

<section class="mx-auto max-w-[96rem] px-4 py-6 md:px-6 md:py-8">
	{#if selection}
		<div class="flex flex-col gap-4">
			<section
				class="rounded-sm bg-[var(--hud-panel)] p-4 md:p-6"
				style="box-shadow: var(--hud-notch-shadow);"
			>
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]"
				>
					<span>Command</span>
					<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
						CHASSIS / ARMAMENT / HARDPOINTS
					</span>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2
							class="font-[var(--font-display)] text-2xl font-semibold uppercase tracking-[0.08em] text-[var(--hud-text)] md:text-3xl"
						>
							Build Planner
						</h2>
						{#if data.creatorName && data.loadedBuild?.is_public}
							<div class="mt-1 flex items-center gap-3">
								<p class="text-xs text-[var(--hud-muted)]">
									Build by <span class="text-[var(--hud-teal)]">{data.creatorName}</span>
								</p>
								{#if data.user && data.loadedBuild.user_id !== data.user.id}
									<button
										class="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition {starred ? 'bg-[var(--hud-inset)] shadow-[inset_2px_0_0_0_var(--hud-lime)]' : 'bg-[var(--hud-inset)]'} hover:text-[var(--hud-teal)]"
										onclick={toggleStar}
										disabled={starring}
										title={starred ? 'Remove star' : 'Star this build'}
									>
										<svg class="h-3.5 w-3.5 transition {starred ? 'text-[var(--hud-lime)]' : 'text-[var(--hud-dim)]'}" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
											<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
										</svg>
										<span class="font-mono text-[var(--hud-muted)]">{starCount}</span>
									</button>
								{:else if !data.user}
									<span class="flex items-center gap-1.5 px-2 py-1 text-xs">
										<svg class="h-3.5 w-3.5 text-[var(--hud-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
										</svg>
										<span class="font-mono text-[var(--hud-dim)]">{starCount}</span>
									</span>
								{/if}
							</div>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<input
							type="text"
							bind:value={buildName}
							maxlength={80}
							placeholder="{currentVehicle.name} Build"
							class="hud-input w-44 px-3 py-2 text-sm text-[var(--hud-text)] md:w-56"
						/>

						{#if data.user}
							<button
								class="hud-cta-ghost px-4 py-2 text-sm"
								disabled={saving}
								onclick={() => saveBuild(editingBuild?.isPublic ?? false)}
							>
								{saving ? 'Saving…' : editingBuild ? 'Update Build' : 'Save Build'}
							</button>
							{#if editingBuild?.isPublic}
							<button
								class="hud-cta-outline px-4 py-2 text-sm"
								onclick={async () => {
									await navigator.clipboard.writeText(
										getAbsoluteUrl(`/builds/${editingBuild!.slug}`, window.location.origin)
									);
									copyLinkLabel = 'Copied!';
									setTimeout(() => (copyLinkLabel = 'Copy Share Link'), 2000);
								}}
							>
								{copyLinkLabel}
							</button>
						{:else}
							<button
								class="hud-cta-outline px-4 py-2 text-sm"
								disabled={saving}
								onclick={() => saveBuild(true)}
							>
								{saving ? 'Sharing…' : 'Share Build'}
							</button>
						{/if}
							{#if editingBuild}
								<button
									class="hud-cta-ghost px-4 py-2 text-sm"
									disabled={saving}
									onclick={saveAsNew}
								>
									Save as New
								</button>
							{/if}
						{:else}
							<a
								href="/auth"
								class="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--hud-muted)] transition hover:text-[var(--hud-teal)]"
							>
								Sign in to save builds
							</a>
						{/if}

						<button
							class="hud-cta-outline px-4 py-2 text-sm"
							disabled={exporting}
							onclick={exportBuild}
						>
							{exporting ? 'Exporting…' : 'Export'}
						</button>

						<button
							class="px-3 py-2 text-sm text-[var(--hud-muted)] transition hover:text-[var(--hud-teal)]"
							onclick={newBuild}
						>
							New Build
						</button>
					</div>
				</div>

				{#if saveError}
					<div
						class="mt-3 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-2 text-sm text-[#ffd166]"
					>
						{saveError}
					</div>
				{/if}
				{#if saveSuccess}
					<div
						class="mt-3 border-l-2 border-[var(--hud-teal)] bg-[var(--hud-inset)] px-4 py-2 text-sm text-[var(--hud-teal)]"
					>
						{saveSuccess}
					</div>
				{/if}
				{#if exportError}
					<div
						class="mt-3 border-l-2 border-[#ffd166] bg-[var(--hud-inset)] px-4 py-2 text-sm text-[#ffd166]"
					>
						{exportError}
					</div>
				{/if}

				<div class="mt-5 grid gap-5">
					<label class="grid gap-2">
						<span class="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]"
							>Vehicle</span
						>
						{#if isVehicleLocked}
							<div
								class="rounded-sm bg-[var(--hud-panel-mid)] px-4 py-4 shadow-[inset_4px_0_0_0_var(--hud-lime),inset_0_0_0_1px_rgba(69,73,50,0.2)]"
							>
								<div>
									<div>
										<div class="font-semibold text-[var(--hud-text)]">{currentVehicle.name}</div>
										<div class="mt-1 text-sm text-[var(--hud-muted)]">
											{currentVehicle.classLabel} class
										</div>
									</div>
								</div>
							</div>
						{:else}
							<select
								class="rounded-sm bg-[var(--hud-inset)] px-4 py-3 text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/35"
								value={selection.vehicleId}
								onchange={(event) => resetForVehicle((event.currentTarget as HTMLSelectElement).value)}
							>
								{#each groupedVehicles as [group, vehicles]}
									<optgroup label={group}>
										{#each vehicles as vehicle}
											<option value={vehicle.id}>{vehicle.name}</option>
										{/each}
									</optgroup>
								{/each}
							</select>
						{/if}
						<div
							class="flex items-center justify-between gap-4 text-sm text-[var(--hud-muted)]"
						>
							<span>
								{#if isVehicleLocked}
									Vehicle locked from selected tank page
								{:else}
									{currentVehicle.classLabel} class
								{/if}
							</span>
							<a
								href="/tools/tanks"
								class="font-semibold text-[var(--hud-teal)] transition hover:text-[var(--hud-lime)]"
							>
								Browse all vehicles
							</a>
						</div>
					</label>
				</div>
			</section>

			<section
				class="rounded-sm bg-[var(--hud-panel)] p-4 md:p-6"
				style="box-shadow: var(--hud-notch-shadow);"
			>
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]"
				>
					<span>Telemetry</span>
					<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
						NODE_ALLOC · {currentVehicle.name} / {currentVehicle.classLabel ?? '—'}
					</span>
				</div>

				<div class="flex flex-col gap-4 pb-4 md:flex-row md:items-end md:justify-between">
					<div>
						<h2
							class="font-[var(--font-display)] text-2xl font-semibold uppercase tracking-[0.08em] text-[var(--hud-text)] md:text-3xl"
						>
							Talent tree
						</h2>
						<p class="mt-1 font-mono text-xs text-[var(--hud-muted)]">
							{currentVehicle.key}
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2 md:gap-3">
						<div
							class="rounded-sm bg-[var(--hud-inset)] px-3 py-2 text-sm shadow-[inset_0_0_0_1px_rgba(69,73,50,0.2)]"
						>
							<span class="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]"
								>Spent</span
							>
							<span class="ml-2 font-mono font-semibold tabular-nums text-[var(--hud-text)]"
								>{spentTalentPoints} / {MAX_TOTAL_TALENT_POINTS}</span
							>
						</div>
						<button
							type="button"
							class="rounded-sm border-2 border-[var(--hud-teal)] bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/10"
							onclick={resetAllTalentPoints}
						>
							Reset points
						</button>
					</div>
				</div>

				<p class="text-sm leading-relaxed text-[var(--hud-muted)]">
					Tiers go left → right. Unlock a column after
					<span class="text-[var(--hud-teal)]">{TALENT_POINTS_REQUIRED_PER_TIER_STEP}× tier index</span>
					pts in lower tiers;
					<span class="text-[var(--hud-teal)]">prerequisites</span> need ≥1 pt each.
					Cap <span class="text-[var(--hud-teal)]">{MAX_TOTAL_TALENT_POINTS}</span>.
					<span class="text-[var(--hud-teal)]">Teal</span> = spent ·
					<span class="text-[var(--hud-lime)]">Lime</span> = keystone ·
					<span class="text-rose-400">Red</span> = invalid.
				</p>

				{#if talentNodes.length === 0}
					<p class="mt-6 text-sm text-[var(--hud-muted)]">No talent tree data for this vehicle.</p>
				{:else}
					<div
						class="mt-4 overflow-x-auto rounded-sm bg-[var(--hud-surface)] p-2 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.15)] md:p-3"
					>
						<div
							class="grid gap-3"
							style={`grid-template-columns: repeat(${talentGridDims.cols}, minmax(10.5rem, 1fr)); grid-template-rows: repeat(${talentGridDims.rows}, 1fr);`}
						>
							{#each talentNodes as node}
								{@const points = getTalentPoints(node.talent.id)}
								{@const prereqOk = talentPrerequisitesSatisfied(node, selection.talentPoints, talentNodes)}
								{@const spentBelow = getPointsSpentInTiersBelow(talentNodes, selection.talentPoints, node.tier)}
								{@const tierReq = getTalentTierUnlockRequirement(node.tier)}
								{@const tierOk = spentBelow >= tierReq}
								{@const ruleLocked = !prereqOk || !tierOk}
								{@const canInc = canIncrementTalentPoint(
									node,
									talentNodes,
									selection.talentPoints,
									points,
									node.maxPoints,
									spentTalentPoints
								)}
								<div
									class={`relative flex flex-col p-2.5 ${talentTileTone(node, points, ruleLocked)}`}
									style={`grid-column: ${node.tier + 1}; grid-row: ${node.row + 1};`}
								>
									<div class="flex items-start justify-between gap-1">
										<h3
											class="min-w-0 text-xs font-bold uppercase leading-tight tracking-[0.04em] text-[var(--hud-text)]"
										>
											{node.talent.name}
										</h3>
										{#if node.isKeystone}
											<span
												class="shrink-0 rounded-sm bg-[var(--hud-lime)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--hud-on-lime)]"
											>
												Key
											</span>
										{/if}
									</div>

									<div
										class="mt-1.5 inline-flex w-fit items-baseline gap-0.5 rounded-sm bg-[var(--hud-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--hud-muted)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.35)]"
									>
										<span class="tabular-nums text-[var(--hud-text)]">{points}</span>
										<span class="text-[#454932]">/</span>
										<span class="tabular-nums text-[var(--hud-dim)]">{node.maxPoints}</span>
									</div>

									<p class="mt-1.5 flex-1 text-xs leading-snug text-[var(--hud-muted)] line-clamp-3">
										{formatTalentDescription(node.talent.description, node.talent.pointValues, points, node.maxPoints)}
									</p>
									{#if node.talent.supplementalDescription}
										<p class="mt-1 text-[10px] leading-snug text-[var(--hud-dim)] line-clamp-2">
											{formatTalentDescription(node.talent.supplementalDescription, node.talent.pointValues, points, node.maxPoints)}
										</p>
									{/if}
	
									<div
										class="mt-1.5 flex items-center justify-end gap-1.5 border-t border-[var(--hud-variant)]/80 pt-1.5"
									>
										<button
											type="button"
											class="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--hud-teal)] bg-transparent text-base leading-none text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/15 disabled:border-[#454932] disabled:text-[#454932] disabled:opacity-40"
											disabled={points <= 0}
											onclick={() =>
												setTalentPoints(node.talent.id, points - 1, node.maxPoints)}
										>
											−
										</button>
										<button
											type="button"
											class="flex h-7 w-7 items-center justify-center rounded-sm bg-[var(--hud-lime)] text-base font-medium leading-none text-[var(--hud-on-lime)] transition hover:brightness-110 disabled:bg-[var(--hud-variant)] disabled:text-[var(--hud-dim)] disabled:opacity-50"
											disabled={!canInc}
											onclick={() =>
												setTalentPoints(node.talent.id, points + 1, node.maxPoints)}
										>
											+
										</button>
									</div>
								</div>
							{/each}
							<!-- Prereq connector overlay — spans entire grid, drawn on top -->
							{#if prereqConnectors.length > 0}
								<svg
									class="pointer-events-none"
									style={`grid-column: 1 / ${talentGridDims.cols + 1}; grid-row: 1 / ${talentGridDims.rows + 1}; z-index: 2; width: 100%; height: 100%;`}
								>
									{#each prereqConnectors as conn}
										{@const active = conn.fromPts >= conn.fromMaxPts && conn.toPts > 0}
										{@const broken = conn.toPts > 0 && conn.fromPts < conn.fromMaxPts}
										{@const cols = talentGridDims.cols}
										{@const rows = talentGridDims.rows}
										<line
											x1={`${((conn.horizontal ? conn.minCol + 0.97 : conn.minCol + 0.5) / cols) * 100}%`}
											y1={`${((!conn.horizontal ? conn.minRow + 0.97 : conn.minRow + 0.5) / rows) * 100}%`}
											x2={`${((conn.horizontal ? conn.maxCol + 0.03 : conn.maxCol + 0.5) / cols) * 100}%`}
											y2={`${((!conn.horizontal ? conn.maxRow + 0.03 : conn.maxRow + 0.5) / rows) * 100}%`}
											stroke={active ? '#66dabe' : '#f43f5e'}
											stroke-opacity={active ? '0.85' : broken ? '1' : '0.25'}
											stroke-width="3"
											stroke-dasharray="none"
											stroke-linecap="round"
										/>
									{/each}
								</svg>
							{/if}
						</div>
					</div>
				{/if}
			</section>

			<section
				class="rounded-sm bg-[var(--hud-panel)] p-4 md:p-5"
				style="box-shadow: var(--hud-notch-shadow);"
			>
				<div
					class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					<span>Loadout</span>
					<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
						HARDPOINTS · {currentVehicle.name}
					</span>
				</div>
				<div class="flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
					<div>
						<span class="mb-2 block text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">Components</span>
						<div class="flex items-stretch gap-2">
							{#each currentVehicle.loadout.defaultAmmoIds as _, index}
								{#if index < currentVehicle.loadout.componentSlotCount}
									{@const picked =
										selection.componentIds[index]
											? catalog.componentById.get(selection.componentIds[index])
											: null}
									<button
										type="button"
										class="group/comp relative flex min-h-[3.5rem] min-w-[7rem] flex-col justify-center rounded-sm px-3 py-2 ring-1 transition {picked
											? 'bg-[var(--hud-panel-mid)] ring-[#454932]/40 hover:ring-[var(--hud-teal)]/50'
											: 'bg-[var(--hud-inset)] ring-[#454932]/25 hover:ring-[var(--hud-teal)]/35'}"
										onclick={() => (componentModalSlot = index)}
									>
										<div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--hud-dim)]">Slot {index + 1}</div>
										{#if picked}
											<div class="mt-1 flex items-center gap-2">
												<span
													class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--hud-variant)]/80 bg-[var(--hud-inset)]/70 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.12)]"
												>
													<FallbackImage
														src="/images/components/{picked.id}.png"
														alt=""
														kind="component"
														label={picked.name}
														class="h-5 w-5 object-contain"
													/>
												</span>
												<div class="min-w-0 text-xs font-semibold leading-snug text-[var(--hud-text)]">
													<div class="truncate">{picked.name}</div>
												</div>
											</div>
										{:else}
											<div class="mt-0.5 text-xs text-[var(--hud-dim)]">Empty</div>
										{/if}
										{#if picked}
											<div
												class="pointer-events-none absolute left-0 top-full z-30 mt-2 w-64 rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel)] p-3 opacity-0 shadow-[0_12px_40px_rgba(0,0,0,0.5)] transition-opacity group-hover/comp:opacity-100"
											>
												<div class="flex items-baseline gap-2">
													<span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]">{picked.name}</span>
													<span class="text-[9px] uppercase tracking-wider text-[var(--hud-dim)]">{formatComponentCategory(picked.category)}</span>
												</div>
												<p class="mt-1.5 text-xs leading-relaxed text-[var(--hud-muted)]">
													{fillComponentDescription(picked.description, picked.pointValues)}
												</p>
											</div>
										{/if}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					<div class="hidden sm:flex sm:items-center sm:self-stretch sm:pt-5">
						<div class="h-full w-px bg-[var(--hud-variant)]"></div>
					</div>

					<div>
						<span class="mb-2 block text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]">Shells</span>
						<div class="flex items-stretch gap-2">
							{#each currentVehicle.loadout.defaultAmmoIds as _, index}
								{@const pickedAmmo = catalog.ammoById.get(selection.ammoIds[index])}
								{@const ammoMods = pickedAmmo?.modifiers}
								{@const ammoHasStats = ammoMods && (ammoMods.damage !== 1 || ammoMods.penetration !== 1 || ammoMods.reload !== 1 || ammoMods.dispersion !== 1 || ammoMods.detection !== 1 || ammoMods.velocity !== 1)}
								<div class="group/ammo relative flex items-stretch gap-0">
									<div
										class="relative flex h-[4.5rem] w-[8.75rem] flex-col rounded-sm ring-1 transition {selection.previewAmmoSlot === index
											? 'bg-[var(--hud-lime)]/8 ring-[var(--hud-lime)]/40 shadow-[inset_0_-2px_0_0_var(--hud-lime)]'
											: 'bg-[var(--hud-inset)] ring-[#454932]/25 hover:ring-[var(--hud-teal)]/35'}"
									>
										{#if index > 0}
											<button
												type="button"
												class="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel-mid)] text-[var(--hud-teal)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.15)] transition hover:border-[var(--hud-teal)]/50 hover:bg-[var(--hud-teal)]/10 hover:text-[var(--hud-text)]"
												aria-label={`Change ${getAmmoSlotTitle(index)}`}
												title={`Change ${getAmmoSlotTitle(index)}`}
												onclick={() => (ammoModalSlot = index)}
											>
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="1.8"
													class="h-3.5 w-3.5"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M6 8h10m0 0-3-3m3 3-3 3M18 16H8m0 0 3-3m-3 3 3 3"
													/>
												</svg>
											</button>
										{/if}
										<button
											type="button"
											class="flex flex-1 flex-col justify-center px-3 py-2 text-left {index > 0 ? 'pr-12' : ''}"
											aria-label={`Preview ${getAmmoSlotTitle(index)} stats`}
											onclick={() => setPreviewAmmoSlot(index)}
										>
											<div class="flex items-center">
												<span class="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--hud-teal)]">
													{getPreviewSlotLabel(index)}
												</span>
											</div>
											<div class="mt-1 flex min-w-0 items-center gap-2">
												{#if pickedAmmo}
													<span
														class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--hud-variant)]/80 bg-[var(--hud-inset)]/70 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.12)]"
													>
														<FallbackImage
															src="/images/ammo/{pickedAmmo.id}.png"
															alt=""
															kind="ammo"
															label={pickedAmmo.displayName}
															class="h-5 w-5 object-contain"
														/>
													</span>
												{/if}
												<div class="min-w-0 truncate text-xs font-semibold text-[var(--hud-text)]">
													{pickedAmmo?.displayName ?? 'Standard'}
												</div>
											</div>
										</button>
									</div>
									{#if pickedAmmo}
										<div
											class="pointer-events-none absolute left-0 top-full z-30 mt-2 w-64 rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-panel)] p-3 opacity-0 shadow-[0_12px_40px_rgba(0,0,0,0.5)] transition-opacity group-hover/ammo:opacity-100"
										>
											<div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-teal)]">
												{pickedAmmo.displayName}
											</div>
											<p class="mt-1 text-xs leading-relaxed text-[var(--hud-muted)]">
												{pickedAmmo.description}
											</p>
											{#if ammoHasStats && ammoMods}
												<div class="mt-2 flex flex-wrap gap-1.5">
													{#each [
														{ label: 'DMG', v: ammoMods.damage },
														{ label: 'PEN', v: ammoMods.penetration },
														{ label: 'RLD', v: ammoMods.reload },
														{ label: 'DSP', v: ammoMods.dispersion },
														{ label: 'DET', v: ammoMods.detection },
														{ label: 'VEL', v: ammoMods.velocity }
													] as m}
														{#if m.v !== 1}
															<span
																class={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
																	m.v > 1
																		? 'bg-emerald-400/12 text-emerald-300'
																		: 'bg-rose-400/12 text-rose-300'
																}`}
															>
																{m.label} {m.v > 1 ? '+' : ''}{Math.round((m.v - 1) * 100)}%
															</span>
														{/if}
													{/each}
												</div>
											{:else}
												<div class="mt-2 text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
													Special effect only
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<section
				class="rounded-sm bg-[var(--hud-panel)] p-4 md:p-5"
				style="box-shadow: var(--hud-notch-shadow);"
			>
				<div
					class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hud-variant)] pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-teal)]"
				>
					<span>Intel</span>
					<span class="font-mono font-normal normal-case tracking-normal text-[var(--hud-muted)]">
						STAT_MATRIX · DERIVED OUTPUT
					</span>
				</div>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2
						class="font-[var(--font-display)] text-xl font-semibold uppercase tracking-[0.06em] text-[var(--hud-text)] md:text-2xl"
					>
						Stat breakdown
					</h2>
					<p class="max-w-md text-xs leading-5 text-[var(--hud-muted)]">
						One category at a time. Switch tabs for weapon, mobility, vision, etc. Use Sources for
						modifier detail.
						<span class="mt-1 block text-[var(--hud-dim)]">
							A <span class="text-[var(--hud-teal)]">teal bolt</span> marks a
							<strong class="font-medium text-[var(--hud-muted)]">situational</strong> talent (e.g. on-hit,
							while spotted — not plain loadout passives).
						</span>
					</p>
				</div>

				{#if computedBuild}
					<div
						class="mt-4 flex flex-wrap gap-1.5 border-b border-[var(--hud-variant)] pb-3"
					>
						{#each groupedStats as [group, cards]}
							<button
								type="button"
								class={`rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
									activeStatGroup === group
										? 'bg-[var(--hud-lime)] text-[var(--hud-on-lime)]'
										: 'bg-[var(--hud-inset)] text-[var(--hud-muted)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.35)] hover:bg-[var(--hud-panel-mid)] hover:text-[var(--hud-text)]'
								}`}
								onclick={() => (activeStatGroup = group)}
							>
								{group}
								<span class="ml-1 opacity-70">({cards.length})</span>
							</button>
						{/each}
					</div>

					<div
						class="mt-3 max-h-[min(75vh,640px)] overflow-x-auto overflow-y-auto rounded-sm bg-[var(--hud-surface)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.15)]"
					>
						<table class="w-full min-w-[32rem] table-fixed text-left text-sm">
							<colgroup>
								<col style="width: 46%" />
								<col style="width: 18%" />
								<col style="width: 18%" />
								<col style="width: 18%" />
							</colgroup>
							<thead
								class="sticky top-0 z-[1] bg-[var(--hud-inset)] shadow-[0_1px_0_rgba(69,73,50,0.5)]"
							>
								<tr class="text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
									<th class="px-3 py-2 font-medium">Stat</th>
									<th class="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums">Base</th>
									<th class="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums">Now</th>
									<th class="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">Δ</th>
								</tr>
							</thead>
							<tbody>
								{#each activeGroupCards as card}
									{@const breakdownRows = computedBuild.breakdown[card.definition.key] ?? []}
									{@const sourcesOpen = statSourcesExpanded[card.definition.key] ?? false}
									<tr
										class="border-t border-[var(--hud-variant)]/60 align-top hover:bg-[var(--hud-panel-mid)]/35"
									>
										<td class="px-3 py-2 align-top">
											<div class="font-medium leading-tight text-[var(--hud-text)]">
												{card.definition.label}
											</div>
											<div
												class="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--hud-dim)]"
											>
												{card.definition.key}
											</div>
											{#if breakdownRows.length}
												<button
													type="button"
													class="mt-1.5 cursor-pointer list-none border-none bg-transparent p-0 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--hud-teal)] hover:text-[var(--hud-lime)]"
													aria-expanded={sourcesOpen}
													onclick={() => toggleStatSources(card.definition.key)}
												>
													Sources ({breakdownRows.length})
												</button>
											{/if}
										</td>
										<td
											class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-[var(--hud-dim)]"
										>
											{formatStatValue(card.base, card.definition.unit)}
										</td>
										<td
											class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-[var(--hud-text)]"
										>
											{formatStatValue(card.value, card.definition.unit)}
										</td>
										<td
											class={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${
												getDeltaTone(card.definition, card.delta) === 'positive'
													? 'text-emerald-300'
													: getDeltaTone(card.definition, card.delta) === 'negative'
														? 'text-rose-300'
														: 'text-[var(--hud-dim)]'
											}`}
										>
											{card.delta > 0 ? '+' : ''}{formatStatValue(card.delta, card.definition.unit)}
										</td>
									</tr>
									{#if sourcesOpen && breakdownRows.length}
										{#each breakdownRows as entry}
											<tr class="border-t border-[var(--hud-variant)]/40 bg-[var(--hud-inset)]/35">
												<td colspan="3" class="px-3 py-2 text-xs align-middle">
													<div
														class="flex min-w-0 flex-wrap items-center gap-2 border-l-2 border-[var(--hud-teal)]/35 py-0.5 pl-2 text-left leading-snug text-[var(--hud-muted)] break-words [word-break:normal]"
													>
														{#if entry.conditional}
															<span
																class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[var(--hud-teal)]/14 text-[var(--hud-teal)] shadow-[inset_0_0_0_1px_rgba(102,218,190,0.28)]"
																title="Situational effect: applies only under specific in-game conditions (on-hit, while spotted, etc.). See item description."
																role="img"
																aria-label="Situational effect"
															>
																<svg
																	xmlns="http://www.w3.org/2000/svg"
																	viewBox="0 0 24 24"
																	fill="currentColor"
																	class="h-3.5 w-3.5"
																	aria-hidden="true"
																>
																	<path
																		d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.62 12 4c1.58 3.62 3.52 6.94 4.81 8.22.02.04.26.22.07.12-.19-.34-.2-.66.38-.66H13l1 7h-1v1h-2v-1z"
																	/>
																</svg>
															</span>
														{/if}
														<span class="min-w-0">{entry.source}</span>
													</div>
												</td>
												<td
													class={`whitespace-nowrap px-3 py-2 align-middle text-right tabular-nums font-semibold ${
														getDeltaTone(card.definition, entry.delta) === 'positive'
															? 'text-emerald-300'
															: getDeltaTone(card.definition, entry.delta) === 'negative'
																? 'text-rose-300'
																: 'text-[var(--hud-dim)]'
													}`}
												>
													{entry.delta > 0 ? '+' : ''}{formatStatValue(entry.delta, card.definition.unit)}
												</td>
											</tr>
										{/each}
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="mt-5 text-[var(--hud-muted)]">Select a vehicle to begin.</p>
				{/if}

				<div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--hud-variant)] pt-4">
					<label
						class="flex items-center gap-2 transition {buildHasConditionals ? 'cursor-pointer hover:text-[var(--hud-text)]' : 'cursor-default opacity-40'}"
					>
						<input type="checkbox" bind:checked={includeConditionalEffects} disabled={!buildHasConditionals} />
						<span class="text-sm text-[var(--hud-muted)]">Include conditional effects</span>
						<span
							class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--hud-dim)] text-[9px] font-bold leading-none text-[var(--hud-dim)]"
							title="Include effects from talents and components that only activate under specific conditions (e.g. on-hit, while spotted, after taking damage). Disable to see only permanent passive bonuses."
						>?</span>
					</label>
					<label
						class="flex items-center gap-2 transition {buildHasStacking ? 'cursor-pointer hover:text-[var(--hud-text)]' : 'cursor-default opacity-40'}"
					>
						<input type="checkbox" bind:checked={assumeMaxStacks} disabled={!buildHasStacking} />
						<span class="text-sm text-[var(--hud-muted)]">Assume max stacks</span>
						<span
							class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--hud-dim)] text-[9px] font-bold leading-none text-[var(--hud-dim)]"
							title="When enabled, stacking effects are calculated at their maximum stack count instead of a single stack. Useful for seeing the full potential of abilities that build up over time."
						>?</span>
					</label>
				</div>
			</section>
		</div>

		{#if componentModalSlot !== null && selection}
			{@const modalSlot = componentModalSlot}
			<div
				class="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6"
				role="presentation"
			>
				<button
					type="button"
					class="absolute inset-0 bg-[#0a0e17]/85 backdrop-blur-[3px]"
					aria-label="Close component browser"
					onclick={closeComponentModal}
				></button>

				<div
					class="relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-t-sm border border-[rgba(69,73,50,0.4)] bg-[var(--hud-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_0_0_1px_var(--hud-ghost)] sm:rounded-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="component-modal-title"
					tabindex="-1"
				>
					<header
						class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--hud-variant)] bg-[var(--hud-panel-high)] px-4 py-4 shadow-[inset_0_2px_0_0_var(--hud-lime)] sm:px-6"
					>
						<div>
							<p
								class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-teal)]"
							>
								Component library
							</p>
							<h2
								id="component-modal-title"
								class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
							>
								Slot {modalSlot + 1} — pick a component
							</h2>
							<p class="mt-2 max-w-2xl text-sm text-[var(--hud-muted)]">
								Already equipped parts are hidden so each component can only be used once. Click a
								card to equip and close.
							</p>
						</div>
						<button
							type="button"
							class="rounded-sm border-2 border-[var(--hud-teal)] bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/10"
							onclick={closeComponentModal}
						>
							Close
						</button>
					</header>

					<div class="shrink-0 border-b border-[var(--hud-variant)] bg-[var(--hud-panel)] px-4 py-3 sm:px-6">
						<input
							type="text"
							bind:value={componentSearchQuery}
							placeholder="Search components…"
							class="w-full rounded-sm bg-[var(--hud-inset)] px-4 py-2.5 text-sm text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.35)] outline-none placeholder:text-[var(--hud-dim)] focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/35"
						/>
					</div>

					<div class="min-h-0 flex-1 overflow-y-auto bg-[var(--hud-surface)] px-4 py-4 sm:px-6 sm:py-5">
						<button
							type="button"
							class="mb-5 w-full rounded-sm border-2 border-dashed border-[var(--hud-dim)] py-3 text-sm font-semibold uppercase tracking-wide text-[var(--hud-muted)] transition hover:border-[var(--hud-teal)] hover:bg-[var(--hud-panel-mid)] hover:text-[var(--hud-text)]"
							onclick={() => {
								setComponent(modalSlot, '');
								closeComponentModal();
							}}
						>
							Clear slot — leave empty
						</button>

						{#each groupedComponentsForSlot(modalSlot, componentSearchQuery) as [category, items]}
							<section class="mb-8 last:mb-0">
								<h3
									class="sticky top-0 z-[1] -mx-1 mb-3 border-b border-[var(--hud-variant)] bg-[var(--hud-surface)] px-1 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[var(--hud-teal)]"
								>
									{formatComponentCategory(category)}
								</h3>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{#each items as component}
										<button
											type="button"
											class={`flex flex-col rounded-sm p-4 text-left ring-1 transition ${
												selection.componentIds[modalSlot] === component.id
													? 'bg-[var(--hud-lime)]/12 ring-[var(--hud-lime)] shadow-[inset_3px_0_0_0_var(--hud-lime)]'
													: 'bg-[var(--hud-panel-mid)] ring-[#454932]/25 hover:ring-[var(--hud-teal)]/35'
											}`}
											onclick={() => {
												setComponent(modalSlot, component.id);
												closeComponentModal();
											}}
										>
											<span class="flex items-center gap-2">
												<FallbackImage
													src="/images/components/{component.id}.png"
													alt=""
													kind="component"
													label={component.name}
													class="h-7 w-7 shrink-0 object-contain"
												/>
												<span class="font-semibold leading-snug text-[var(--hud-text)]"
													>{component.name}</span
												>
												{#if nativeComponentIds.has(component.id)}
													<span
														class="shrink-0 rounded-sm bg-[var(--hud-lime)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--hud-lime)]"
													>
														Native
													</span>
												{/if}
											</span>
											<span class="mt-1 text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
												{formatComponentCategory(component.category)}
											</span>
											<p
												class="mt-2 flex-1 text-xs leading-relaxed text-[var(--hud-muted)] line-clamp-4 sm:line-clamp-5"
												title={fillComponentDescription(component.description, component.pointValues)}
											>
												{fillComponentDescription(component.description, component.pointValues)}
											</p>
										</button>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		{#if ammoModalSlot !== null}
			{@const modalAmmoSlot = ammoModalSlot}
			<div
				class="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6"
				role="presentation"
			>
				<button
					type="button"
					class="absolute inset-0 bg-[#0a0e17]/85 backdrop-blur-[3px]"
					aria-label="Close ammo browser"
					onclick={closeAmmoModal}
				></button>

				<div
					class="relative z-10 flex max-h-[min(92vh,700px)] w-full max-w-4xl flex-col overflow-hidden rounded-t-sm border border-[rgba(69,73,50,0.4)] bg-[var(--hud-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_0_0_1px_var(--hud-ghost)] sm:rounded-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="ammo-modal-title"
					tabindex="-1"
				>
					<header
						class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--hud-variant)] bg-[var(--hud-panel-high)] px-4 py-4 shadow-[inset_0_2px_0_0_var(--hud-lime)] sm:px-6"
					>
						<div>
							<p
								class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-teal)]"
							>
								Ammunition library
							</p>
							<h2
								id="ammo-modal-title"
								class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
							>
								Select {getAmmoSlotTitle(modalAmmoSlot)}
							</h2>
						</div>
						<button
							type="button"
							class="rounded-sm border-2 border-[var(--hud-teal)] bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/10"
							onclick={closeAmmoModal}
						>
							Close
						</button>
					</header>

					<div class="min-h-0 flex-1 overflow-y-auto bg-[var(--hud-surface)] px-4 py-4 sm:px-6 sm:py-5">
						<button
							type="button"
							class="mb-5 w-full rounded-sm border-2 border-dashed border-[var(--hud-dim)] py-3 text-sm font-semibold uppercase tracking-wide text-[var(--hud-muted)] transition hover:border-[var(--hud-teal)] hover:bg-[var(--hud-panel-mid)] hover:text-[var(--hud-text)]"
							onclick={() => {
								setAmmo(modalAmmoSlot, 'standard');
								closeAmmoModal();
							}}
						>
							Reset to Standard
						</button>

						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each catalog.ammo.filter((a) => modalAmmoSlot !== 1 || a.canLoadSecondary) as ammo}
								{@const isSelected = selection.ammoIds[modalAmmoSlot] === ammo.id}
								{@const modifiers = ammo.modifiers}
								{@const hasStatChanges = modifiers.damage !== 1 || modifiers.penetration !== 1 || modifiers.reload !== 1 || modifiers.dispersion !== 1 || modifiers.detection !== 1 || modifiers.velocity !== 1}
								<button
									type="button"
									class={`flex flex-col rounded-sm p-4 text-left ring-1 transition ${
										isSelected
											? 'bg-[var(--hud-lime)]/12 ring-[var(--hud-lime)] shadow-[inset_3px_0_0_0_var(--hud-lime)]'
											: 'bg-[var(--hud-panel-mid)] ring-[#454932]/25 hover:ring-[var(--hud-teal)]/35'
									}`}
									onclick={() => {
										setAmmo(modalAmmoSlot, ammo.id);
										closeAmmoModal();
									}}
								>
									<span class="flex items-center gap-2">
										<FallbackImage
											src="/images/ammo/{ammo.id}.png"
											alt=""
											kind="ammo"
											label={ammo.displayName}
											class="h-7 w-7 shrink-0 object-contain"
										/>
										<span class="font-semibold leading-snug text-[var(--hud-text)]"
											>{ammo.displayName}</span
										>
									</span>
									<p class="mt-1 flex-1 text-xs leading-relaxed text-[var(--hud-muted)]">
										{ammo.description}
									</p>
									{#if hasStatChanges}
										<div class="mt-2 flex flex-wrap gap-1.5">
											{#each [
												{ label: 'DMG', value: modifiers.damage, tip: 'Shell Damage' },
												{ label: 'PEN', value: modifiers.penetration, tip: 'Shell Penetration' },
												{ label: 'RLD', value: modifiers.reload, tip: 'Reload Time' },
												{ label: 'DSP', value: modifiers.dispersion, tip: 'Dispersion (all types)' },
												{ label: 'DET', value: modifiers.detection, tip: 'Detection Radius' },
												{ label: 'VEL', value: modifiers.velocity, tip: 'Shell Velocity' }
											] as mod}
												{#if mod.value !== 1}
													<span
														class={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
															mod.value > 1
																? 'bg-emerald-400/12 text-emerald-300'
																: 'bg-rose-400/12 text-rose-300'
														}`}
														title={`${mod.tip}: ${mod.value > 1 ? '+' : ''}${Math.round((mod.value - 1) * 100)}%`}
													>
														{mod.label} {mod.value > 1 ? '+' : ''}{Math.round((mod.value - 1) * 100)}%
													</span>
												{/if}
											{/each}
										</div>
									{:else}
										<div class="mt-2 text-[10px] uppercase tracking-wider text-[var(--hud-dim)]">
											No stat modifiers — special effect only
										</div>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if exportModalOpen}
			<div
				class="fixed inset-0 z-[210] flex items-end justify-center sm:items-center sm:p-6"
				role="presentation"
			>
				<button
					type="button"
					class="absolute inset-0 bg-[#0a0e17]/85 backdrop-blur-[3px]"
					aria-label="Close export dialog"
					onclick={closeExportModal}
				></button>

				<div
					class="relative z-10 flex w-full max-w-3xl flex-col overflow-hidden rounded-t-sm border border-[rgba(69,73,50,0.4)] bg-[var(--hud-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_0_0_1px_var(--hud-ghost)] sm:rounded-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="export-modal-title"
				>
					<header
						class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--hud-variant)] bg-[var(--hud-panel-high)] px-4 py-4 shadow-[inset_0_2px_0_0_var(--hud-lime)] sm:px-6"
					>
						<div>
							<p
								class="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--hud-teal)]"
							>
								Loadout sharing
							</p>
							<h2
								id="export-modal-title"
								class="mt-1 font-[var(--font-display)] text-2xl font-bold uppercase tracking-[0.04em] text-[var(--hud-text)]"
							>
								Export Build
							</h2>
							<p class="mt-2 text-xs leading-5 text-[var(--hud-muted)]">
								Paste this share code into Tyr's in-game import tool.
							</p>
						</div>
						<button
							type="button"
							class="rounded-sm border-2 border-[var(--hud-teal)] bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--hud-teal)] transition hover:bg-[var(--hud-teal)]/10"
							onclick={closeExportModal}
						>
							Close
						</button>
					</header>

					<div class="bg-[var(--hud-surface)] px-4 py-4 sm:px-6 sm:py-5">
						<textarea
							readonly
							class="min-h-[9rem] w-full resize-none rounded-sm border border-[var(--hud-variant)] bg-[var(--hud-inset)] px-3 py-3 font-mono text-xs leading-6 text-[var(--hud-text)] outline-none"
							onfocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
						>{exportCode}</textarea>

						<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
							<p class="text-xs leading-5 text-[var(--hud-muted)]">
								This code includes vehicle, components, shells, and talent allocations.
							</p>
							<button
								type="button"
								class="hud-cta-outline px-4 py-2 text-xs"
								onclick={copyExportCode}
							>
								{copyExportCodeLabel}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div
			class="mt-8 rounded-sm bg-[var(--hud-panel)] p-6 text-[var(--hud-muted)] shadow-[inset_2px_0_0_0_var(--hud-teal),inset_0_0_0_1px_var(--hud-ghost)]"
		>
			<p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-teal)]">Command</p>
			<p class="mt-2 font-mono text-sm">Loading planner data…</p>
		</div>
	{/if}
</section>

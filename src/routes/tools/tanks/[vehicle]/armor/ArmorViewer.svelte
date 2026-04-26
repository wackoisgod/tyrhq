<script lang="ts">
	import { Canvas } from '@threlte/core';
	import VehicleModel from './VehicleModel.svelte';
	import type { ArmorHitInfo } from './types';

	let {
		vehicleId,
		onhover,
		onclick,
		shellPenetration = 90,
		showArmorVisualizer = true
	}: {
		vehicleId: string;
		onhover: (info: ArmorHitInfo | null) => void;
		onclick: (info: ArmorHitInfo | null) => void;
		shellPenetration?: number;
		showArmorVisualizer?: boolean;
	} = $props();
</script>

<div class="relative h-full w-full bg-[var(--hud-surface)]">
	<div
		class="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:48px_48px]"
	></div>

	<Canvas>
		<VehicleModel {vehicleId} {onhover} {onclick} {shellPenetration} {showArmorVisualizer} />
	</Canvas>
</div>

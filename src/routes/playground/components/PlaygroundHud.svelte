<script lang="ts">
	import { LOCATION_MAP } from '$lib/locations';
	import { formatTime, getSkyState } from '$lib/utils';
	import { pg } from '../lib/playground-state.svelte';

	let { isBoosting = false }: { isBoosting?: boolean } = $props();

	const currentLocation = $derived(LOCATION_MAP.get(pg.activeLocation) ?? Array.from(LOCATION_MAP.values())[0]);
	const skyState = $derived(getSkyState(pg.timeOfDay));
</script>

<!-- HUD chips — bottom-left -->
<div class="hud">
	<span><b>{currentLocation.name}</b></span>
	<span>HDG {pg.heading.toFixed(0)}°</span>
	<span>ALT {(pg.altitude / 1000).toFixed(0)}k</span>
	<span>SPD {pg.planeSpeed.toFixed(1)}×</span>
	<span>{formatTime(pg.timeOfDay)}</span>
	<span class="sky-tag sky-{skyState}">{skyState.toUpperCase()}</span>
	<span class="wx-tag">{pg.weather.toUpperCase()}</span>
	{#if isBoosting}<span class="boost-tag">⚡ BOOST</span>{/if}
</div>

<style>
	.hud {
		position: absolute;
		bottom: 16px;
		left: 16px;
		z-index: 10;
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 12px;
		background: rgba(10, 10, 15, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #f0f0f0;
		padding: 8px 12px;
		border-radius: 12px;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
		pointer-events: none;
		max-width: calc(100vw - 90px);
		animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes fadeUp {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.hud span {
		padding: 2px 6px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 4px;
	}
	.sky-tag.sky-night { background: #1a2040; color: #7faeff; }
	.sky-tag.sky-dawn  { background: #402818; color: #ffb070; }
	.sky-tag.sky-dusk  { background: #301838; color: #d080e0; }
	.sky-tag.sky-day   { background: #204060; color: #a0d4ff; }
	.wx-tag { background: #202028; color: #c0c4cc; }
	.boost-tag {
		background: #ff8844 !important;
		color: #fff !important;
		animation: pulse 0.6s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		from { opacity: 0.85; }
		to { opacity: 1; }
	}
</style>

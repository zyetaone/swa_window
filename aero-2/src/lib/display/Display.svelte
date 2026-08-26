<script lang="ts">
	/**
	 * Display — Top-level parent feature component for the kiosk window display.
	 * Composes the outside 3D world (Stage / CesiumStage), aircraft wing silhouette (Wing),
	 * inside cabin chrome (Frame), minimap (MiniMap), and telemetry status band (Hud).
	 *
	 * Uses Svelte 5 <svelte:boundary> to isolate 3D WebGL runtime errors from taking
	 * down the cabin frame or operator UI.
	 */
	import Stage from './world/Stage.svelte';
	import CesiumStage from './world/CesiumStage.svelte';
	import Clouds from './world/Clouds.svelte';
	import Wing from './cabin/Wing.svelte';
	import Frame from './cabin/Frame.svelte';
	import Blind from './cabin/Blind.svelte';
	import RainGlass from './cabin/RainGlass.svelte';
	import Hud from './cabin/Hud.svelte';
	import MiniMap from './flight/MiniMap.svelte';
	import MediaStage from './media/MediaStage.svelte';
	import AudioHost from './media/AudioHost.svelte';
	import { useDisplay } from './display.svelte.js';
	import type { Snippet } from 'svelte';

	interface Props {
		clouds?: boolean;
		wing?: boolean;
		minimap?: boolean;
		hud?: boolean;
		blind?: boolean;
		children?: Snippet;
	}

	let {
		clouds = true,
		wing = true,
		minimap = true,
		hud = true,
		blind = true,
		children
	}: Props = $props();

	const display = useDisplay();

	function onStageError(error: unknown) {
		console.error('[AeroDisplay] 3D World Stage error caught by boundary:', error);
	}
</script>

<div class="aero-display">
	<!-- 3D World protected by Svelte 5 Error Boundary -->
	<svelte:boundary onerror={onStageError}>
		{#if display.config.engine === 'cesium'}
			<CesiumStage />
		{:else}
			<Stage />
		{/if}

		{#snippet failed(error, reset)}
			<div class="stage-error-fallback">
				<div class="glass-panel error-card">
					<h3>Display Signal Lost</h3>
					<p>{error instanceof Error ? error.message : 'WebGL rendering error'}</p>
					<button type="button" class="glass-btn" onclick={reset}>Re-initialize Stage</button>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>

	{#if clouds}
		<Clouds />
	{/if}
	{#if wing}
		<Wing />
	{/if}
	<RainGlass />
	<Frame />
	{#if blind}
		<Blind />
	{/if}
	{#if minimap}
		<MiniMap />
	{/if}
	{#if hud}
		<Hud />
	{/if}
	<MediaStage />
	<AudioHost />
	{@render children?.()}
</div>

<style>
	.aero-display {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
		user-select: none;
	}
	.stage-error-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #05080e;
		z-index: 1;
	}
	.error-card {
		padding: 24px;
		text-align: center;
		max-width: 360px;
	}
	.error-card h3 {
		margin: 0 0 8px 0;
		color: #f87171;
	}
	.error-card p {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 16px;
	}
</style>

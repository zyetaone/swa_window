<script lang="ts">
	/**
	 * Display — Top-level parent feature component for the kiosk window display.
	 * Composes the outside 3D world (Stage / CesiumStage), aircraft wing silhouette (Wing),
	 * inside cabin chrome (Frame), minimap (MiniMap), and telemetry status band (Hud).
	 *
	 * Uses Svelte 5 <svelte:boundary> to isolate 3D WebGL runtime errors from taking
	 * down the cabin frame or operator UI.
	 */
	// './world/Stage.svelte', NOT './world/maplibre/Stage.svelte'. The latter
	// exists only in another session's uncommitted working tree, and an earlier
	// commit here picked the line up mid-edit -- so main pointed at a directory
	// git has never seen and a clean clone could not build.
	import Stage from './world/Stage.svelte';
	import CesiumStage from './world/cesium/CesiumStage.svelte';
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

	/**
	 * `hud` is the only switch here, because it is the only one with a caller.
	 *
	 * There used to be five -- clouds, wing, minimap, blind -- and +page.svelte
	 * passed exactly one of them. Three of the other four duplicated a config
	 * knob the child already reads (`Clouds` gates on `config.clouds`, `Wing` on
	 * `config.wing`, `Blind` on `config.blindOpen`), so the same light had two
	 * switches and only one of them was wired to anything.
	 */
	interface Props {
		hud?: boolean;
		children?: Snippet;
	}

	let { hud = true, children }: Props = $props();

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

		<!-- Inside the boundary, like the rest of the 3D world: Clouds runs its
		     own WebGL context and can lose it exactly the way Stage can. It sat
		     outside, so a Three.js context loss took down the whole page while
		     the identical failure in MapLibre was caught and offered a retry. -->
		<Clouds />

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

	<Wing />
	<RainGlass />
	<Frame />
	<Blind />
	<MiniMap />
	<!-- `visible`, not `{#if}`: Hud owns the `--hud-height` CSS variable the
	     rest of the cabin lays out against, and unmounting it left that variable
	     stale at the ribbon height with no ribbon under it. -->
	<Hud visible={hud} />
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

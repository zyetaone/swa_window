<script lang="ts">
	/**
	 * GlobeLayer — mounts Cesium + Three overlay + watchdogs inside the scene.
	 *
	 * Three overlay is dynamically imported so the kiosk cold path does not
	 * parse Threlte/Three when useThreeOverlay is false (or until first enable).
	 */
	import { untrack } from "svelte";
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { subscribe } from "$lib/game-loop";
	import CesiumViewer from "$lib/world/CesiumViewer.svelte";
	import { startLivenessWatchdog } from '$lib/world/lifecycle-liveness';
	import { startOverlayRecovery, isOverlayPersistentlyDisabled, hasExplicitOverlayParam } from '$lib/world/lifecycle-overlay-recovery';

	const model = useAeroWindow();

	if (typeof window !== 'undefined' && isOverlayPersistentlyDisabled() && !hasExplicitOverlayParam()) {
		model.applyConfigPatch('world.useThreeOverlay', false);
	}

	let overlayResets = 0;
	const MAX_OVERLAY_RESETS = 3;
	function onOverlayError(error: unknown, reset: () => void): void {
		model.telemetry.recordEvent('error', {
			where: 'three-overlay',
			message: error instanceof Error ? error.message : String(error),
		});
		if (overlayResets < MAX_OVERLAY_RESETS) {
			overlayResets++;
			setTimeout(reset, 4000);
		}
	}

	$effect(() => {
		return subscribe((dt: number) => {
			untrack(() => model.tick(dt));
		});
	});

	$effect(() => {
		return startLivenessWatchdog({
			getFps: () => untrack(() => model.measuredFps),
			recordEvent: (kind, payload) => model.telemetry.recordEvent(kind, payload),
		});
	});

	$effect(() => {
		return startOverlayRecovery({
			getFps: () => untrack(() => model.measuredFps),
			disableOverlay: () => {
				model.applyConfigPatch('world.useThreeOverlay', false);
				model.telemetry.recordEvent('error', {
					where: 'overlay-recovery',
					reason: 'sustained-low-fps',
					fps: model.measuredFps,
				});
			},
		});
	});

	const fps = $derived(Math.round(model.measuredFps));
	const wantOverlay = $derived(model.config.world.useThreeOverlay);
</script>

{#if wantOverlay}
	<svelte:boundary onerror={onOverlayError}>
		{#await import('$lib/world/three/ThreeOverlay.svelte') then { default: ThreeOverlay }}
			<ThreeOverlay />
		{:catch}
			<!-- Dynamic import failed — stay Cesium-only; recovery can retry later. -->
		{/await}
		{#snippet failed()}{/snippet}
	</svelte:boundary>
{/if}

<div class="render-layer">
	<CesiumViewer />
</div>

{#if import.meta.env.DEV}
	<div class="fps-badge">FPS {fps}</div>
{/if}
<style>
	.fps-badge { position: absolute; top: 8px; left: 8px; z-index: 100; background: rgba(0,0,0,0.55); color: #0f0; font: 11px monospace; padding: 2px 6px; border-radius: 3px; pointer-events: none; }
</style>

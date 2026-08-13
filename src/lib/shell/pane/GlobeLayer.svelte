<script lang="ts">
	/**
	 * GlobeLayer — mounts Cesium + Three overlay + watchdogs inside the scene.
	 *
	 * Three overlay is dynamically imported so the kiosk cold path does not
	 * parse Threlte/Three when useThreeOverlay is false (or until first enable).
	 *
	 * `active` (default true): when false (video/slideshow covering the wall),
	 * keep Cesium warm (no destroy/remount) but pause the render loop, model
	 * tick, and liveness — return-to-flight is instant and GPU stays free.
	 */
	import { untrack } from "svelte";
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { subscribe } from "$lib/game-loop";
	import CesiumViewer from "$lib/world/CesiumViewer.svelte";
	import { activeCesium } from '$lib/world/active.svelte';
	import { startLivenessWatchdog } from '$lib/world/lifecycle-liveness';
	import { startOverlayRecovery, isOverlayPersistentlyDisabled, hasExplicitOverlayParam } from '$lib/world/lifecycle-overlay-recovery';

	let { active = true }: { active?: boolean } = $props();

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

	// Sim tick only while the globe is the visible path.
	$effect(() => {
		if (!active) return;
		return subscribe((dt: number) => {
			untrack(() => model.tick(dt));
		});
	});

	// FPS stall while media covers the wall is expected — don't reload.
	$effect(() => {
		if (!active) return;
		return startLivenessWatchdog({
			getFps: () => untrack(() => model.measuredFps),
			recordEvent: (kind, payload) => model.telemetry.recordEvent(kind, payload),
		});
	});

	$effect(() => {
		if (!active) return;
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

	// Pause Cesium's continuous render loop while media is up. Viewer stays
	// alive so return-to-flight does not pay cold WebGL init.
	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;
		const viewer = mgr.getViewer();
		// useDefaultRenderLoop is the Cesium continuous RAF; false freezes draws.
		viewer.useDefaultRenderLoop = active;
		return () => {
			// On unmount / teardown, leave loop on if the viewer still exists.
			try {
				viewer.useDefaultRenderLoop = true;
			} catch {
				/* destroyed */
			}
		};
	});

	const fps = $derived(Math.round(model.measuredFps));
	const wantOverlay = $derived(model.config.world.useThreeOverlay && active);
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

{#if import.meta.env.DEV && active}
	<div class="fps-badge">FPS {fps}</div>
{/if}
<style>
	.fps-badge { position: absolute; top: 8px; left: 8px; z-index: 100; background: rgba(0,0,0,0.55); color: #0f0; font: 11px monospace; padding: 2px 6px; border-radius: 3px; pointer-events: none; }
</style>

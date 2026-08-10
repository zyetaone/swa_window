<script lang="ts">
	/**
	 * GlobeLayer — mounts Cesium + Three overlay + watchdogs inside the scene.
	 *
	 * Every concern that needs the Cesium Manager, the Three overlay, or the
	 * RAF game loop lives here. The parent (Pane.svelte) handles layout chrome
	 * (oval frame, glass, blind) and delegates the globe to this component.
	 */
	import { untrack } from "svelte";
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { subscribe } from "$lib/game-loop";
	import CesiumViewer from "$lib/world/CesiumViewer.svelte";
	import ThreeOverlay from "$lib/world/three/ThreeOverlay.svelte";
import { startLivenessWatchdog } from '$lib/world/lifecycle-liveness';
import { startOverlayRecovery, isOverlayPersistentlyDisabled, hasExplicitOverlayParam } from '$lib/world/lifecycle-overlay-recovery';

	const model = useAeroWindow();

	// ── Overlay auto-recovery: boot-time check ──────────────────────────────
	// An explicit ?overlay= param (parsed in +page.svelte, which runs before
	// this child inits) is an operator override — it must win over the
	// persisted auto-disable, otherwise ?overlay=1 is silently clobbered.
	if (typeof window !== 'undefined' && isOverlayPersistentlyDisabled() && !hasExplicitOverlayParam()) {
		model.applyConfigPatch('world.useThreeOverlay', false);
	}

	// ── Overlay error boundary state ────────────────────────────────────────
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

	// ── GAME LOOP ───────────────────────────────────────────────────────────
	$effect(() => {
		return subscribe((dt: number) => {
			untrack(() => model.tick(dt));
		});
	});

	// ── Liveness watchdog ───────────────────────────────────────────────────
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

	// The persisted overlay-disabled flag is cleared ONLY by explicit
	// re-enable paths (SidePanel toggle in LightingControls, ?overlay=1 in
	// +page.svelte) — NOT reactively here. A reactive clear would fire on any
	// useThreeOverlay=true write (fleet push, CRDT replay) and wipe a weak
	// Pi's self-preservation state.
	const fps = $derived(Math.round(model.measuredFps));
</script>

<svelte:boundary onerror={onOverlayError}>
	{#if model.config.world.useThreeOverlay}
		<ThreeOverlay />
	{/if}
	{#snippet failed()}{/snippet}
</svelte:boundary>

<div class="render-layer">
	<CesiumViewer />
</div>

{#if import.meta.env.DEV}
	<div class="fps-badge">FPS {fps}</div>
{/if}
<style>
	.fps-badge { position: absolute; top: 8px; left: 8px; z-index: 100; background: rgba(0,0,0,0.55); color: #0f0; font: 11px monospace; padding: 2px 6px; border-radius: 3px; pointer-events: none; }
</style>

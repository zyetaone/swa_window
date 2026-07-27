<script lang="ts">
	/**
	 * GlobeLayer — mounts Cesium + Three overlay + watchdogs inside the scene.
	 *
	 * Every concern that needs the Cesium Manager, the Three overlay, or the
	 * RAF game loop lives here. The parent (Pane.svelte) handles layout chrome
	 * (oval frame, glass, blind) and delegates the globe to this component.
	 */
	import { untrack } from "svelte";
	import { useAeroWindow } from "llib/model/aero-window.svelte";
	import { subscribe } from "llib/game-loop";
	import CesiumViewer from "llib/world/CesiumViewer.svelte";
	import ThreeOverlay from "llib/world/three/ThreeOverlay.svelte";
	import Compositor from 'llib/scene/compositor.svelte';
	import Weather from './window/Weather.svelte';
	import { activeCesium } from 'llib/world/active.svelte';
	import { installHashPalette } from 'llib/world/hash-palette';
	import { startLivenessWatchdog } from 'llib/world/liveness';
	import { startOverlayRecovery, isOverlayPersistentlyDisabled, clearOverlayDisabled } from 'llib/world/overlay-recovery';

	const model = useAeroWindow();

	// ── Overlay auto-recovery: boot-time check ──────────────────────────────
	if (typeof window !== 'undefined' && isOverlayPersistentlyDisabled()) {
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
	leffect(() => {
		return subscribe((dt: number) => {
			untrack(() => model.tick(dt));
		});
	});

	// ── Liveness watchdog ───────────────────────────────────────────────────
	leffect(() => {
		return startLivenessWatchdog({
			getFps: () => untrack(() => model.measuredFps),
			recordEvent: (kind, payload) => model.telemetry.recordEvent(kind, payload),
		});
	});

	// ── Overlay recovery ────────────────────────────────────────────────────
	leffect(() => {
		return startOverlayRecovery({
			getFps: () => untrack(() => model.measuredFps),
			disableOverlay: () => {
				model.config.world.useThreeOverlay = false;
				model.telemetry.recordEvent('error', {
					where: 'overlay-recovery',
					reason: 'sustained-low-fps',
					fps: model.measuredFps,
				});
			},
		});
	});

	leffect(() => {
		if (model.config.world.useThreeOverlay) {
			clearOverlayDisabled();
		}
	});

	// ── Hash-palette ────────────────────────────────────────────────────────
	leffect(() => {
		if (!model.config.world.useHashPalette) return;
		const viewer = activeCesium.manager?.getViewer();
		if (!viewer) return;
		const cleanup = installHashPalette(
			viewer,
			() => model.nightFactor,
			() => model.nightLightScale,
			() => model.config.world.darkVoidStrength,
			() => model.config.world.envLight,
			() => model.config.world.additiveStrength,
		);
		return cleanup;
	});

	const windAngle = lderived(model.config.atmosphere.weather.windAngle);
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

<Compositor />

<Weather rainOpacity={0} {windAngle} frostAmount={0} />

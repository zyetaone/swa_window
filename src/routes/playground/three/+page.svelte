<script lang="ts">
	/**
	 * /playground/three — CESIUM + THREE.JS COMPOSITION LAB.
	 *
	 * After hitting the fundamental ceilings of pure-Three Earth rendering
	 * at WGS84 cruise scale (2 K-equirect texture upscale, mesh-face vs.
	 * heightmap-pixel size mismatch, bumpmap-not-DEM source data), this
	 * route is now a COMPOSITION:
	 *
	 *   Cesium       → terrain + imagery + VIIRS night lights + atmosphere
	 *                  + the production color-grade shader + bloom.
	 *                  Everything its tile-streaming pipeline already does.
	 *   ThreeOverlay → transparent canvas above Cesium. Camera mirrored
	 *                  from Cesium each frame. Hosts the cluster cloud
	 *                  sprite system (the only Three.js-side asset that
	 *                  proved genuinely valuable in this lab) + room for
	 *                  future custom shader passes.
	 *
	 * Same shell + same model context as /playground (the lean Cesium lab) —
	 * the only difference is the added Three.js overlay. If a technique
	 * here proves out (volumetric cloud variants, post-process passes,
	 * Bruneton scattering), port the CONCEPT into the shared compose path.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribe } from '$lib/game-loop';
	import CesiumViewer from '$lib/world/CesiumViewer.svelte';
	import ThreeOverlay from '$lib/world-three/ThreeOverlay.svelte';
	import LabShell from '$lib/playground/LabShell.svelte';
	import HUD from '$lib/shell/HUD.svelte';
	import BlindInfoCard from '$lib/shell/hud/BlindInfoCard.svelte';
	import { hybridDebug } from '$lib/world-three/lab-debug';
	import { activeCesium } from '$lib/world/active.svelte';

	const model = createAeroWindow();

	// Cesium buildings as wireframe ("line marks") instead of filled cubes —
	// honors the user's "buildings from the texture map line marks" intent.
	// Fires when the CesiumManager finishes its async mount; idempotent.
	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;
		mgr.setBuildingsWireframe(true);
	});

	// RAF tick — same pattern as /playground. Drives flight + motion + director.
	$effect(() => subscribe((dt) => model.tick(dt)));

	// Snap the flight engine to the show's opening location.
	model.setLocation(model.location);

	// Cesium's OSM-buildings primitive stays enabled — empirically it
	// supplies the majority of the visible city-light density we want.
	// The Three-side `OsmBuildingEdges` component overlays footprint
	// outlines (extra "city traced in light" character) on top. Together
	// they read as "mass + outline" — closer to the user's original
	// "flow around" intent than disabling either alone.
	// (Toggle this to false to inspect the Three-only outline contribution.)

	let cityMode = $state(false);

	// City-mode lock — pins altitude at 500 ft and keeps the flight engine's
	// altitude lerp suppressed by re-triggering the user-interaction override
	// (8 s window) every 6 s while active. Toggle resumes normal autopilot.
	$effect(() => {
		if (!cityMode) return;
		model.flight.altitude = 500;
		model.onUserInteraction('altitude');
		const i = setInterval(() => {
			model.flight.altitude = 500;
			model.onUserInteraction('altitude');
		}, 6000);
		return () => clearInterval(i);
	});
</script>

<LabShell 
	title="Three.js Lab" 
	hint="Threlte composite · stylized renderer for R&D"
	{model}
	showCityMode
	bind:cityMode
	onCityToggle={() => { cityMode = !cityMode; }}
>
	{#snippet viewer()}
		<!-- Cesium owns the globe + atmosphere + post-process. -->
		<CesiumViewer />
		<!-- Three.js overlay above, camera-mirrored from Cesium. -->
		<ThreeOverlay />
		<!-- Wing silhouette — same CSS shape as production Pane.svelte,
		     overlaid on the viewer. Bank-angle-rolled + vertically bobbed
		     by the motion engine so it reads as "you're inside a plane". -->
		{#if model.config.shell.showWing}
			<div
				class="wing-silhouette"
				style:transform={`translateY(${(model.motion.motionOffsetY * 0.45 + model.motion.engineVibeY * 0.6).toFixed(2)}px) rotate(${(-2 + model.motion.bankAngle * 0.55).toFixed(2)}deg)`}
			></div>
		{/if}

		<!-- Production HUD spike for hybrid validation (ADR-004).
		     Renders the real TelemetryOverlay / BlindInfoCard (driven by the shared
		     model.config.shell.blindOpen + flight state) over the Cesium + Three scene.
		     This lets us see the exact production chrome against the artistic layers,
		     godrays, bloom, neon, meteors, etc. before porting the full shell. -->
		<HUD />

		<!-- Hybrid debug overlay (expanded in All! batch).
		     Small, deletable panel showing live artistic + postprocess state.
		     Only visible in this lab for validation of the Three layers over Cesium. -->
		<div class="hybrid-debug">
			<div class="label">Hybrid Debug</div>
			<div class="row">night: <span>{model.nightFactor.toFixed(2)}</span></div>
			<div class="row">clouds: <span>{(model.effectiveCloudDensity * 100).toFixed(0)}%</span></div>
			<div class="row">godrays: <span>{hybridDebug.godrayOpacity.toFixed(2)}</span></div>
			<div class="row">bloomThr: <span>{hybridDebug.bloomThreshold.toFixed(2)}</span></div>
			<div class="row">neon: <span>roads+edges</span></div>
			<div class="row">meteors: <span>{model.nightFactor > 0.5 ? 'on' : 'off'}</span></div>
			<div class="row">3-Pi: <span>{model.config.camera.parallax.role}</span></div>
		</div>

		<!-- Shell mounting spike experiment (All! batch, Item 1).
		     Concrete test of real production shell chrome over the hybrid renderer.
		     Currently forcing a real BlindInfoCard (centered, reduced opacity) + a
		     minimal Glass test layer to observe z-index, backdrop-filter interaction,
		     and readability against the artistic layers + EffectStack postprocess.
		     This is throwaway — delete or expand freely. -->
		<div style="position:absolute; inset:0; z-index:25; pointer-events:none; opacity:0.55;">
			<BlindInfoCard />
		</div>

		<!-- Second shell experiment layer: minimal Glass test (backdrop + vignette) -->
		<div class="shell-glass-test" style="position:absolute; inset:0; z-index:26; pointer-events:none;">
			<div class="glass-vignette"></div>
		</div>
	{/snippet}

	{#snippet diag()}
		<aside class="diag">
			<div><b>Cesium + Three Lab</b></div>
			<div>flight: <code>{model.flight.camLat.toFixed(2)}°N, {model.flight.camLon.toFixed(2)}°E, {(model.flight.camAlt / 1000).toFixed(2)}k ft</code></div>
			<div>nightFactor: <code>{model.nightFactor.toFixed(2)}</code> · weather: <code>{model.weather}</code></div>
			<div>cloud density: <code>{(model.effectiveCloudDensity * 100).toFixed(0)}%</code></div>
		</aside>
	{/snippet}

	{#snippet extraControls()}
		<fieldset>
			<legend>Night intensity</legend>
			<label>
				<span class="val">{(model.config.world.nightLightIntensity * 100).toFixed(0)}%</span>
				<input
					type="range"
					bind:value={model.config.world.nightLightIntensity}
					min="0"
					max="3"
					step="0.05"
				/>
			</label>
		</fieldset>

		<fieldset>
			<legend>3-Pi Role (simulator)</legend>
			<select
				value={model.config.camera.parallax.role}
				onchange={(e) => {
					const role = (e.currentTarget as HTMLSelectElement).value as any;
					const p = model.config.camera.parallax;
					p.role = role;
					if (role === 'left') {
						p.headingOffsetDeg = -18; p.fovDeg = 42;
					} else if (role === 'right') {
						p.headingOffsetDeg = 18; p.fovDeg = 42;
					} else if (role === 'center') {
						p.headingOffsetDeg = 0; p.fovDeg = 45;
					} else {
						p.headingOffsetDeg = 0; p.fovDeg = 45;
					}
				}}
			>
				<option value="solo">solo (0°)</option>
				<option value="left">left (−18°)</option>
				<option value="center">center (0°)</option>
				<option value="right">right (+18°)</option>
			</select>
			<div style="font-size:10px;opacity:0.7;margin-top:3px;">
				offset: <code>{model.config.camera.parallax.headingOffsetDeg.toFixed(0)}°</code> · 
				fov: <code>{model.config.camera.parallax.fovDeg.toFixed(0)}°</code>
				<button 
					style="margin-left:6px;font-size:9px;padding:1px 4px;"
					onclick={() => {
						const p = model.config.camera.parallax;
						p.role = 'solo'; p.headingOffsetDeg = 0; p.fovDeg = 45;
					}}
				>reset</button>
				<button 
					style="margin-left:4px;font-size:9px;padding:1px 4px;"
					onclick={() => {
						const p = model.config.camera.parallax;
						const roles = ['solo', 'left', 'center', 'right'] as const;
						const idx = (roles.indexOf(p.role) + 1) % roles.length;
						const next = roles[idx];
						p.role = next;
						if (next === 'left') { p.headingOffsetDeg = -18; p.fovDeg = 42; }
						else if (next === 'right') { p.headingOffsetDeg = 18; p.fovDeg = 42; }
						else { p.headingOffsetDeg = 0; p.fovDeg = 45; }
					}}
				>cycle</button>
			</div>
			<div style="font-size:9px;opacity:0.5;">
				Tests CameraMirror inheritance of real parallax config.
				<button style="margin-left:4px;font-size:8px;" onclick={() => {
					const p = model.config.camera.parallax;
					console.log('3-Pi parallax:', { role: p.role, headingOffsetDeg: p.headingOffsetDeg, fovDeg: p.fovDeg });
				}}>log</button>
				<!-- Small visual feedback for current offset + bank (All! Item 4) -->
				<span style="margin-left:8px; font-family:monospace; color:#7faeff;">
					{ model.config.camera.parallax.headingOffsetDeg > 0 ? '+' : '' }{model.config.camera.parallax.headingOffsetDeg}°
					| bank: {model.motion.bankAngle.toFixed(1)}°
				</span>
			</div>
		</fieldset>
	{/snippet}
</LabShell>

<style>
	/* All .playground / drawer / chip-row / fieldset / .diag / .city-btn styles
	   now live in LabShell (single source of truth for both lean labs). */

	/* Wing silhouette — exact shape copied from src/lib/shell/Pane.svelte
	   so the lab matches what the production Cesium route shows. Scoped to
	   this route's viewer snippet. transform-origin matches Pane so the
	   bank-angle rotation pivots around the wing's outer tip, not centre. */
	.wing-silhouette {
		position: absolute;
		bottom: -5%;
		left: -15%;
		width: 75%;
		height: 35%;
		pointer-events: none;
		transform-origin: 80% 100%;
		z-index: 7;
		background: linear-gradient(
			25deg,
			rgba(20, 20, 25, 0.7) 0%,
			rgba(30, 30, 35, 0.5) 20%,
			rgba(40, 40, 50, 0.25) 40%,
			transparent 60%
		);
	}

	/* Minimal hybrid debug panel (All! item 1) — deletable after validation */
	.hybrid-debug {
		position: absolute;
		bottom: 12px;
		left: 12px;
		background: rgba(10, 10, 15, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 10px;
		color: #aaa;
		z-index: 20;
		pointer-events: auto;
	}
	.hybrid-debug .label {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		opacity: 0.6;
		margin-bottom: 2px;
	}
	.hybrid-debug .row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		line-height: 1.3;
	}
	.hybrid-debug .row span {
		color: #7faeff;
		font-family: ui-monospace, monospace;
	}

	/* Shell Glass test layer (All! Item 1) — minimal deletable experiment */
	.shell-glass-test .glass-vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse at center,
			transparent 40%,
			rgba(0, 0, 0, 0.25) 70%,
			rgba(0, 0, 0, 0.45) 100%
		);
		backdrop-filter: blur(1.5px);
		pointer-events: none;
	}
</style>

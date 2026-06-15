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
	import { setParallaxRole } from '$lib/model/config-tree.svelte';
	import { subscribe } from '$lib/game-loop';
	import CesiumViewer from '$lib/world/CesiumViewer.svelte';
	import ThreeOverlay from '$lib/world-three/ThreeOverlay.svelte';
	import LabShell from '$lib/playground/LabShell.svelte';
	import WindowChrome from '$lib/shell/WindowChrome.svelte';
	import HUD from '$lib/shell/HUD.svelte';
	import DevWingTuner from '$lib/world-three/DevWingTuner.svelte';
	import { hybridDebug } from '$lib/world-three/lab-debug';
	import { activeCesium } from '$lib/world/active.svelte';

	const model = createAeroWindow();

	// This lab ALWAYS mounts <ThreeOverlay/> (it IS the hybrid surface), so the
	// `useThreeOverlay` flag must reflect that — otherwise every Cesium↔Three
	// dedup gate (car-lights, CartoDB road-mask, DOM clouds/shooting-stars)
	// stays inactive here and the Cesium layers double the Three ones (the
	// white road blowout + popping). Not persisted (not in PersistedState), so
	// this never leaks to the Cesium-only ship route.
	model.config.world.useThreeOverlay = true;

	// Cesium buildings: wireframe ("line marks") vs solid (the live procedural
	// window-shader facades). Toggle in the drawer — wireframe hides the lit
	// windows, solid shows them. Solid is the default so the vertical lit-
	// window grids ARE the night look; flip to wireframe for the Tron pass.
	// Re-applies whenever the toggle or the manager changes; idempotent.
	let buildingsWireframe = $state(false);
	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;
		mgr.setBuildingsWireframe(buildingsWireframe);
	});

	// RAF tick — same pattern as /playground. Drives flight + motion + director.
	$effect(() => subscribe((dt) => model.tick(dt)));

	// Snap the flight engine to the show's opening location.
	model.setLocation(model.location);

	// Cesium's OSM-buildings primitive stays enabled — it supplies the bulk of
	// the city-light mass. The night-city detail above it is now CityLightField
	// (the soft VIIRS bokeh carpet) + OsmRoads (sharp amber streets); the old
	// OsmBuildingEdges footprint-outline overlay was pulled — the carpet + streets
	// cover that read without the competing rectangles.

	let cityMode = $state(false);

	// City-mode lock — pins altitude at 500 ft and keeps the flight engine's
	// altitude lerp suppressed by re-triggering the user-interaction override
	// (8 s window) every 6 s while active. Toggle resumes normal autopilot.
	// Uses setTimeout chain instead of setInterval — avoids a race where
	// rapid cityMode toggles could leave an orphaned interval handle.
	$effect(() => {
		if (!cityMode) return;
		model.flight.altitude = 500;
		model.onUserInteraction('altitude');
		let active = true;
		const schedule = () => {
			if (!active) return;
			setTimeout(() => {
				if (!active) return;
				model.flight.altitude = 500;
				model.onUserInteraction('altitude');
				schedule();
			}, 6000);
		};
		schedule();
		return () => { active = false; };
	});

	// Lab-only fov-per-role (production keeps fov at the config default). The
	// heading offset is NOT duplicated here — setParallaxRole() is the SSOT for
	// that (+ fuselageOffsetM); this map only carries the lab's fov override.
	const ROLE_FOV = { left: 42, center: 45, right: 42, solo: 45 } as const;
</script>

<LabShell 
	title="Three.js Lab" 
	hint="Threlte composite · stylized renderer for R&D"
	{model}
	showCityMode
	bind:cityMode
>
	{#snippet viewer()}
		<!-- Full shipping window shell (oval frame + glass + pull-down blind)
		     wrapping the Cesium globe + Three overlay — the lab now previews the
		     complete composition, not just the bare render. WindowChrome adds no
		     CesiumViewer of its own and no DOM Compositor, so the Three overlay's
		     clouds aren't doubled. Frame toggles via config.shell.windowFrame. -->
		<WindowChrome>
			<!-- Cesium owns the globe + atmosphere + post-process. -->
			<CesiumViewer />
			<!-- Three.js overlay above, camera-mirrored from Cesium (wing,
			     clouds, sky, neon). -->
			<ThreeOverlay />
		</WindowChrome>

		<!-- Production HUD spike for hybrid validation (ADR-004).
		     Renders the real TelemetryOverlay / BlindInfoCard (driven by the shared
		     model.config.shell.blindOpen + flight state) over the Cesium + Three scene.
		     This lets us see the exact production chrome against the artistic layers,
		     godrays, bloom, neon, meteors, etc. before porting the full shell. -->
		<HUD />

		<!-- Hybrid debug overlay — live artistic + postprocess state readout.
		     Lab-only instrument for validating the Three layers over Cesium. -->
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
	{/snippet}

	{#snippet diag()}
		<aside class="diag">
			<div><b>Cesium + Three Lab</b></div>
			<div>flight: <code>{model.flight.camLat.toFixed(2)}°N, {model.flight.camLon.toFixed(2)}°E, {(model.flight.camAlt / 1000).toFixed(2)}k ft</code></div>
			<div>nightFactor: <code>{model.nightFactor.toFixed(2)}</code> · weather: <code>{model.weather}</code></div>
			<div>cloud density: <code>{(model.effectiveCloudDensity * 100).toFixed(0)}%</code></div>
			{#if model.config.shell.clockVisible}
				<div class="clock">
					{(() => {
						const h = Math.floor(model.timeOfDay);
						const m = Math.floor((model.timeOfDay - h) * 60);
						return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
					})()}
				</div>
			{/if}
		</aside>
	{/snippet}

	{#snippet extraControls()}
		{#if import.meta.env.DEV}
			<DevWingTuner />
		{/if}

		<fieldset>
			<legend>HUD</legend>
			<label style="display:flex;align-items:center;gap:6px;font-size:11px;">
				<input type="checkbox" bind:checked={model.config.shell.clockVisible} />
				Show clock
			</label>
		</fieldset>

		<fieldset>
			<legend>Buildings</legend>
			<label style="display:flex;align-items:center;gap:6px;font-size:11px;">
				<input type="checkbox" bind:checked={buildingsWireframe} />
				Wireframe (off = lit window facades)
			</label>
		</fieldset>

		<fieldset>
			<legend>Night city flyover</legend>
			<button
				type="button"
				class={['city-btn', model.config.camera.flyoverPitchDeg !== 0 && 'active']}
				onclick={() => {
					const turningOn = model.config.camera.flyoverPitchDeg === 0;
					model.config.camera.flyoverPitchDeg = turningOn ? -60 : 0;
					if (turningOn) {
						// Snap the orbit to the current city, drop low + deep night so
						// the camera looks DOWN at the lit ground (VIIRS + roads + dome).
						model.setLocation(model.location);
						model.setTime(2);
						model.setAltitude(8000);
						model.onUserInteraction('altitude');
					}
				}}
			>
				{model.config.camera.flyoverPitchDeg !== 0 ? '✓ Flyover — looking down' : 'Night City Flyover'}
			</button>
			<div style="font-size:10px;opacity:0.65;margin-top:3px;">
				Pitches the camera down over the city to preview the night lights
				(VIIRS + dotted roads + glow dome). Toggle off to return to the wing view.
			</div>
		</fieldset>

		<!-- Weather control lives in LabShell's chip-row (single source) — the
		     duplicate <select> that was here was removed. -->

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
					const role = (e.currentTarget as HTMLSelectElement).value as keyof typeof ROLE_FOV;
					// setParallaxRole is the SSOT — sets role, headingOffsetDeg,
					// AND fuselageOffsetM (the latter drives Wing.svelte's per-Pi
					// position so the wing visibly shifts between left/center/right).
					setParallaxRole(role);
					// Lab-only fov override (production keeps fov at config default).
					model.config.camera.parallax.fovDeg = ROLE_FOV[role];
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
						setParallaxRole('solo');
						model.config.camera.parallax.fovDeg = ROLE_FOV.solo;
					}}
				>reset</button>
				<button
					style="margin-left:4px;font-size:9px;padding:1px 4px;"
					onclick={() => {
						const roles = ['solo', 'left', 'center', 'right'] as const;
						const idx = (roles.indexOf(model.config.camera.parallax.role) + 1) % roles.length;
						const next = roles[idx];
						setParallaxRole(next);
						model.config.camera.parallax.fovDeg = ROLE_FOV[next];
					}}
				>cycle</button>
			</div>
			<div style="font-size:9px;opacity:0.5;">
				Tests CameraMirror inheritance of real parallax config.
				<!-- offset + bank readout -->
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

	/* Base diag panel — was unstyled (the "moved to LabShell" comment was wrong;
	   LabShell's scoped CSS can't reach this snippet's markup), so it rendered
	   unpositioned and clipped to a few px at top-left. Pin + style it. */
	.diag {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 20;
		max-width: 340px;
		padding: 8px 11px;
		background: rgba(10, 10, 15, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		font-size: 11px;
		line-height: 1.5;
		color: #cdd6e6;
		pointer-events: none;
	}
	.diag :global(code) {
		color: #7faeff;
		font-family: ui-monospace, monospace;
	}

	.diag .clock {
		font-family: ui-monospace, monospace;
		font-size: 22px;
		color: #cfe5ff;
		letter-spacing: 1px;
		margin-top: 4px;
		text-shadow: 0 0 8px rgba(120, 180, 255, 0.4);
	}
</style>

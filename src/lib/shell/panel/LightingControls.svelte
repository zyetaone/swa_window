<script lang="ts">
	/**
	 * LightingControls — operator-tunable night-light + scene-lighting knobs.
	 *
	 * Surfaces Phase 9/10 hash-palette + Cesium-API tunables that an on-site
	 * operator may want to adjust for the install (calibrate vs ambient room
	 * light, viewer distance, etc.). The other 7 Phase 9/10 fields remain in
	 * config-tree.svelte.ts as aesthetic constants — change via admin code
	 * push if ever needed, not via slider.
	 *
	 * Routes operator writes through applyConfigPatch so every config
	 * change is CRDT-stamped (peer Pis see the flip via peer-sync) and
	 * prototype-pollution-hardened. Direct `config.X = v` writes (the
	 * previous bind: idiom) skip the gate and silently break fleet sync.
	 *
	 * Mounted in two trees: the kiosk SidePanel (AeroWindow context —
	 * model.applyConfigPatch adds telemetry + fleet broadcast) and /admin
	 * (no context — module-level gate; startPeerSync propagates to peers).
	 */
	import { patchNum, usePanelConfig } from './patch';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';

	const { cfg, patch } = usePanelConfig();
</script>
<section>
	<h4>Lighting</h4>
		<RangeSlider
		label="Night Lights (VIIRS scale)"
		min={0}
		max={5.0}
		step={0.1}
		value={cfg.world.nightLightIntensity}
		oninput={patchNum(patch, 'world.nightLightIntensity')}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="additiveStrength"
		label="City Light Punch"
		min={0}
		max={15}
		step={0.25}
		value={cfg.world.additiveStrength}
		oninput={patchNum(patch, 'world.additiveStrength')}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="moonlightIntensity"
		label="Moonlight Peak"
		min={0.035}
		max={0.3}
		step={0.005}
		value={cfg.world.moonlightIntensity}
		oninput={patchNum(patch, 'world.moonlightIntensity')}
		formatValue={(v) => v.toFixed(3)}
	/>
	<RangeSlider
		id="skyDarken"
		label="Sky Darken"
		min={0.5}
		max={4.0}
		step={0.05}
		value={cfg.world.skyDarken}
		oninput={patchNum(patch, 'world.skyDarken')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="nightExposure"
		label="Night Exposure"
		min={0.4}
		max={1.5}
		step={0.025}
		value={cfg.world.nightExposure}
		oninput={patchNum(patch, 'world.nightExposure')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="viirsBrightness"
		label="VIIRS Brightness ×"
		min={0.5}
		max={3.0}
		step={0.05}
		value={cfg.world.viirsBrightness}
		oninput={patchNum(patch, 'world.viirsBrightness')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<!-- P8 perf-gate A/B: flip the photoreal Three.js overlay live in the space
	     (wing / clouds / moon / neon city / postprocess) without a URL param.
	     Local to this device — for a fleet-wide flip use admin /api/config. -->
	<Toggle label="Three.js Overlay" checked={cfg.world.useThreeOverlay} onchange={(e) => patch('world.useThreeOverlay', e.currentTarget.checked)} />
	<Toggle label="Hash Palette (Night)" checked={cfg.world.useHashPalette} onchange={(e) => patch('world.useHashPalette', e.currentTarget.checked)} />
	<Toggle label="3D Buildings" checked={cfg.world.buildingsEnabled} onchange={(e) => patch('world.buildingsEnabled', e.currentTarget.checked)} />
	<Toggle label="Cesium Clouds (auto-off when Three.js overlay active)" checked={cfg.world.useCesiumClouds} onchange={(e) => patch('world.useCesiumClouds', e.currentTarget.checked)} />
	<Toggle label="Window Frame" checked={cfg.shell.windowFrame} onchange={(e) => patch('shell.windowFrame', e.currentTarget.checked)} />
	<Toggle label="Touch (Demo Mode)" checked={cfg.shell.touchEnabled} onchange={(e) => patch('shell.touchEnabled', e.currentTarget.checked)} />
	<Toggle label="Cursor Parallax" checked={cfg.shell.mouseParallax} onchange={(e) => patch('shell.mouseParallax', e.currentTarget.checked)} />
	<!-- Wing position + mirror — adjust how the wing sits in the window -->
	<RangeSlider id="wingX" label="Wing Position" min={-12} max={2} step={0.1}
		value={cfg.world.wingXBase}
		oninput={patchNum(patch, 'world.wingXBase')}
		formatValue={(v) => v.toFixed(1)} />
	<!-- Wing mirror: flip the screen-drift sign when the wing mirror looks wrong -->
	<Toggle label="Wing Mirror Flip" checked={cfg.world.wingDriftSign === -1} onchange={(e) => patch('world.wingDriftSign', e.currentTarget.checked ? -1 : 1)} />
</section>

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
	 * Routes operator writes through model.applyConfigPatch so every config
	 * change is CRDT-stamped (peer Pis see the flip via peer-sync) and
	 * prototype-pollution-hardened. Direct `config.X = v` writes (the
	 * previous bind: idiom) skip the gate and silently break fleet sync.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';

	const model = useAeroWindow();
</script>
<section>
	<h4>Lighting</h4>
		<RangeSlider
		label="Night Lights (VIIRS scale)"
		min={0}
		max={5.0}
		step={0.1}
		value={model.config.world.nightLightIntensity}
		oninput={(e) => model.applyConfigPatch('world.nightLightIntensity', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="additiveStrength"
		label="City Light Punch"
		min={0}
		max={15}
		step={0.25}
		value={model.config.world.additiveStrength}
		oninput={(e) => model.applyConfigPatch('world.additiveStrength', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="moonlightIntensity"
		label="Moonlight Peak"
		min={0.035}
		max={0.3}
		step={0.005}
		value={model.config.world.moonlightIntensity}
		oninput={(e) => model.applyConfigPatch('world.moonlightIntensity', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(3)}
	/>
	<RangeSlider
		id="skyDarken"
		label="Sky Darken"
		min={0.5}
		max={4.0}
		step={0.05}
		value={model.config.world.skyDarken}
		oninput={(e) => model.applyConfigPatch('world.skyDarken', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="nightExposure"
		label="Night Exposure"
		min={0.4}
		max={1.5}
		step={0.025}
		value={model.config.world.nightExposure}
		oninput={(e) => model.applyConfigPatch('world.nightExposure', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="viirsBrightness"
		label="VIIRS Brightness ×"
		min={0.5}
		max={3.0}
		step={0.05}
		value={model.config.world.viirsBrightness}
		oninput={(e) => model.applyConfigPatch('world.viirsBrightness', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(2)}
	/>
	<!-- P8 perf-gate A/B: flip the photoreal Three.js overlay live in the space
	     (wing / clouds / moon / neon city / postprocess) without a URL param.
	     Local to this device — for a fleet-wide flip use admin /api/config. -->
	<Toggle label="Three.js Overlay" checked={model.config.world.useThreeOverlay} onchange={(e) => model.applyConfigPatch('world.useThreeOverlay', e.currentTarget.checked)} />
	<Toggle label="Hash Palette (Night)" checked={model.config.world.useHashPalette} onchange={(e) => model.applyConfigPatch('world.useHashPalette', e.currentTarget.checked)} />
	<Toggle label="3D Buildings" checked={model.config.world.buildingsEnabled} onchange={(e) => model.applyConfigPatch('world.buildingsEnabled', e.currentTarget.checked)} />
	<Toggle label="Cesium Clouds (auto-off when Three.js overlay active)" checked={model.config.world.useCesiumClouds} onchange={(e) => model.applyConfigPatch('world.useCesiumClouds', e.currentTarget.checked)} />
	<Toggle label="Window Frame" checked={model.config.shell.windowFrame} onchange={(e) => model.applyConfigPatch('shell.windowFrame', e.currentTarget.checked)} />
	<Toggle label="Touch (Demo Mode)" checked={model.config.shell.touchEnabled} onchange={(e) => model.applyConfigPatch('shell.touchEnabled', e.currentTarget.checked)} />
	<Toggle label="Cursor Parallax" checked={model.config.shell.mouseParallax} onchange={(e) => model.applyConfigPatch('shell.mouseParallax', e.currentTarget.checked)} />
	<!-- Wing position + mirror — adjust how the wing sits in the window -->
	<RangeSlider id="wingX" label="Wing Position" min={-12} max={2} step={0.1}
		value={model.config.world.wingXBase}
		oninput={(e) => model.applyConfigPatch('world.wingXBase', parseFloat(e.currentTarget.value))}
		formatValue={(v) => v.toFixed(1)} />
	<!-- Wing mirror: flip the screen-drift sign when the wing mirror looks wrong -->
	<Toggle label="Wing Mirror Flip" checked={model.config.world.wingDriftSign === -1} onchange={(e) => model.applyConfigPatch('world.wingDriftSign', e.currentTarget.checked ? -1 : 1)} />
</section>

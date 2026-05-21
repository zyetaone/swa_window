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
	 * Binds directly to the module-scope config rune so the component is
	 * portable across device / admin / preview surfaces.
	 */
	import { config } from '$lib/model/config-tree.svelte';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';
</script>

<section>
	<h4>Lighting</h4>
	<RangeSlider
		id="nightLight"
		label="Night Lights (VIIRS scale)"
		min={0}
		max={5.0}
		step={0.1}
		value={config.world.nightLightIntensity}
		formatValue={(v) => v.toFixed(1)}
		oninput={(e) => (config.world.nightLightIntensity = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="additiveStrength"
		label="City Light Punch"
		min={0}
		max={15}
		step={0.25}
		value={config.world.additiveStrength}
		formatValue={(v) => v.toFixed(1)}
		oninput={(e) => (config.world.additiveStrength = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="moonlightIntensity"
		label="Moonlight Peak"
		min={0.035}
		max={0.3}
		step={0.005}
		value={config.world.moonlightIntensity}
		formatValue={(v) => v.toFixed(3)}
		oninput={(e) => (config.world.moonlightIntensity = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="skyDarken"
		label="Sky Darken"
		min={0.5}
		max={4.0}
		step={0.05}
		value={config.world.skyDarken}
		formatValue={(v) => v.toFixed(2)}
		oninput={(e) => (config.world.skyDarken = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="nightExposure"
		label="Night Exposure"
		min={0.4}
		max={1.5}
		step={0.025}
		value={config.world.nightExposure}
		formatValue={(v) => v.toFixed(2)}
		oninput={(e) => (config.world.nightExposure = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="viirsBrightness"
		label="VIIRS Brightness ×"
		min={0.5}
		max={3.0}
		step={0.05}
		value={config.world.viirsBrightness}
		formatValue={(v) => v.toFixed(2)}
		oninput={(e) => (config.world.viirsBrightness = parseFloat(e.currentTarget.value))}
	/>
	<Toggle label="3D Buildings" bind:checked={config.world.buildingsEnabled} />
	<Toggle label="Window Frame" bind:checked={config.shell.windowFrame} />
	<Toggle label="Touch (Demo Mode)" bind:checked={config.shell.touchEnabled} />
	<Toggle label="Cursor Parallax" bind:checked={config.shell.mouseParallax} />
</section>

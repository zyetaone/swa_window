<script lang="ts">
	/**
	 * AtmosphereControls — cloud density / cloud speed / haze sliders.
	 *
	 * Binds directly to the module-scope config rune — no AeroWindow model
	 * context required. Any surface (device side-panel, admin editor,
	 * marketing preview) can mount this component and get the same reactive
	 * binding on the same `$state` leaves. Ranges pull from the config tree's
	 * own min/max SSOT.
	 */
	import { config } from '$lib/model/config-tree.svelte';
	import RangeSlider from '../RangeSlider.svelte';
</script>

<section>
	<h4>Atmosphere</h4>
	<RangeSlider
		id="clouds"
		label="Cloud Cover"
		min={0}
		max={1.0}
		step={0.05}
		value={config.atmosphere.clouds.density}
		formatValue={(v) => Math.round(v * 100) + '%'}
		oninput={(e) => (config.atmosphere.clouds.density = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="cloudSpeed"
		label="Cloud Speed"
		min={config.director.ambient.cloudSpeedMin}
		max={config.director.ambient.cloudSpeedMax}
		step={0.1}
		value={config.atmosphere.clouds.speed}
		formatValue={(v) => v.toFixed(1) + 'x'}
		oninput={(e) => (config.atmosphere.clouds.speed = parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="haze"
		label="Haze"
		min={config.atmosphere.haze.min}
		max={config.atmosphere.haze.max}
		step={0.005}
		value={config.atmosphere.haze.amount}
		formatValue={(v) => Math.round(v * 100) + '%'}
		oninput={(e) => (config.atmosphere.haze.amount = parseFloat(e.currentTarget.value))}
	/>
</section>

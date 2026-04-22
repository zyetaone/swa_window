<script lang="ts">
	/**
	 * AtmosphereControls — cloud density / cloud speed / haze sliders.
	 * Ranges pull from director.ambient + atmosphere.haze config SSOT.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import RangeSlider from '../RangeSlider.svelte';

	const model = useAppState();
</script>

<section>
	<h4>Atmosphere</h4>
	<RangeSlider
		id="clouds"
		label="Cloud Cover"
		min={0}
		max={1.0}
		step={0.05}
		value={model.config.atmosphere.clouds.density}
		formatValue={(v) => Math.round(v * 100) + '%'}
		oninput={(e) => model.applyConfigPatch('atmosphere.clouds.density', parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="cloudSpeed"
		label="Cloud Speed"
		min={model.config.director.ambient.cloudSpeedMin}
		max={model.config.director.ambient.cloudSpeedMax}
		step={0.1}
		value={model.config.atmosphere.clouds.speed}
		formatValue={(v) => v.toFixed(1) + 'x'}
		oninput={(e) => model.applyConfigPatch('atmosphere.clouds.speed', parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="haze"
		label="Haze"
		min={model.config.atmosphere.haze.min}
		max={model.config.atmosphere.haze.max}
		step={0.005}
		value={model.config.atmosphere.haze.amount}
		formatValue={(v) => Math.round(v * 100) + '%'}
		oninput={(e) => model.applyConfigPatch('atmosphere.haze.amount', parseFloat(e.currentTarget.value))}
	/>
</section>

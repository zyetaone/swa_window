<script lang="ts">
	/**
	 * LightingControls — night light intensity slider + 3D buildings toggle +
	 * window frame toggle. Binds directly to the module-scope config rune so
	 * the component is portable across device / admin / preview surfaces.
	 */
	import { config } from '$lib/model/config-tree.svelte';
	import Toggle from '../Toggle.svelte';
	import RangeSlider from '../RangeSlider.svelte';
</script>

<section>
	<h4>Lighting</h4>
	<RangeSlider
		id="nightLight"
		label="Night Lights"
		min={0}
		max={5.0}
		step={0.1}
		value={config.world.nightLightIntensity}
		formatValue={(v) => v.toFixed(1)}
		oninput={(e) => (config.world.nightLightIntensity = parseFloat(e.currentTarget.value))}
	/>
	<Toggle label="3D Buildings" bind:checked={config.world.buildingsEnabled} />
	<Toggle label="Window Frame" bind:checked={config.shell.windowFrame} />
</section>

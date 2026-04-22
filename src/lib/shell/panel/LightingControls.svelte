<script lang="ts">
	/**
	 * LightingControls — night light intensity slider + view toggles.
	 * Toggle.checked is $bindable — bind straight to config $state.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import Toggle from '../Toggle.svelte';
	import RangeSlider from '../RangeSlider.svelte';

	const model = useAeroWindow();
</script>

<section>
	<h4>Lighting</h4>
	<RangeSlider
		id="nightLight"
		label="Night Lights"
		min={0}
		max={5.0}
		step={0.1}
		value={model.config.world.nightLightIntensity}
		formatValue={(v) => v.toFixed(1)}
		oninput={(e) => model.applyConfigPatch('world.nightLightIntensity', parseFloat(e.currentTarget.value))}
	/>
	<Toggle
		label="3D Buildings"
		checked={model.config.world.buildingsEnabled}
		onchange={() => model.applyConfigPatch('world.buildingsEnabled', !model.config.world.buildingsEnabled)}
	/>
	<Toggle label="Window Frame" bind:checked={model.config.shell.windowFrame} />
</section>

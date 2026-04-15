<script lang="ts">
	/**
	 * LightingControls — night light intensity slider + view toggles.
	 * Toggle.checked is $bindable — bind straight to config $state.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import Toggle from '../Toggle.svelte';
	import RangeSlider from '../RangeSlider.svelte';

	const model = useAppState();
</script>

<section>
	<h4>Lighting</h4>
	<RangeSlider
		id="nightLight"
		label="Night Lights"
		min={0}
		max={5.0}
		step={0.1}
		value={model.nightLightIntensity}
		formatValue={(v) => v.toFixed(1)}
		oninput={(e) => model.applyPatch({ nightLightIntensity: parseFloat(e.currentTarget.value) })}
	/>
	<Toggle
		label="3D Buildings"
		checked={model.showBuildings}
		onchange={() => model.toggleBuildings()}
	/>
	<Toggle label="Window Frame" bind:checked={model.config.shell.windowFrame} />
</section>

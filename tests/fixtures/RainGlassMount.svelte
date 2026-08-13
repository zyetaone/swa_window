<script lang="ts">
	/**
	 * Test fixture: RainGlass with a real AeroWindow context, weather forced to
	 * rain so the bead layer actually mounts.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import RainGlass from '$lib/shell/window/RainGlass.svelte';

	const model = createAeroWindow();
	model.weather = 'rain';
</script>

<RainGlass />

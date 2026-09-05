<script lang="ts">
	/**
	 * Test fixture: SidePanel with a real AeroWindow context (default role
	 * 'solo' shows the ops chrome).
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import SidePanel from '$lib/shell/operator/SidePanel.svelte';

	createAeroWindow();
</script>

<SidePanel />

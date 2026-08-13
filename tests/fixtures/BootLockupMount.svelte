<script lang="ts">
	/**
	 * Test fixture: BootLockup with a real AeroWindow context. Exposes the
	 * model so the test can drive fps via model.telemetry.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import type { AeroWindow } from '$lib/model/aero-window.svelte';
	import BootLockup from '$lib/shell/BootLockup.svelte';

	let { onprovide }: { onprovide: (model: AeroWindow) => void } = $props();

	// svelte-ignore state_referenced_locally -- calling at INIT mirrors the
	// kiosk composition in +page.svelte.
	onprovide(createAeroWindow());
</script>

<BootLockup />

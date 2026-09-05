<script lang="ts">
	/**
	 * Test fixture: a component that is context-OPTIONAL, exactly like
	 * AtmosphereControls / LightingControls. Mounted with a provider (kiosk) and
	 * without one (/admin) to prove tryUseAeroWindow() doesn't kill the page.
	 */
	import { tryUseAeroWindow } from '$lib/model/aero-window.svelte';

	let { onresolve }: { onresolve: (model: unknown) => void } = $props();

	// This runs during component init — the exact moment the old code threw.
	// svelte-ignore state_referenced_locally -- calling at INIT is the point:
	// that is the exact moment the context lookup used to throw.
	onresolve(tryUseAeroWindow());
</script>

<div data-testid="optional">mounted</div>

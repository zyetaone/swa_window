<script lang="ts">
	/**
	 * The window display — declarative root composition.
	 *
	 * Composes the two high-level feature slices:
	 *   <Display>   Kiosk window display (Stage + Wing + Frame + MiniMap + Hud)
	 *   <Settings>  Operator tuning & admin diagnostics drawers
	 */
	import { page } from '$app/state';
	import { readSettings } from '#lib/settings/settings.svelte.js';
	import Settings from '#lib/settings/Settings.svelte';
	import { createDisplay } from '#lib/display/display.svelte.js';
	import Display from '#lib/display/Display.svelte';

	createDisplay(readSettings(page.url));

	let showSettings = $state(false);
	let showAdmin = $state(false);
	let showHud = $state(true);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 's' || e.key === 'S') showSettings = !showSettings;
		if (e.key === 'a' || e.key === 'A') showAdmin = !showAdmin;
		if (e.key === 'h' || e.key === 'H') showHud = !showHud;
		if (e.key === 'Escape') {
			showSettings = false;
			showAdmin = false;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>aero-2</title></svelte:head>

<Display hud={showHud}>
	<Settings bind:showSettings bind:showAdmin />
</Display>

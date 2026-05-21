<script lang="ts">
	let { children } = $props();

	// Dev-mode cursor restore — app.html unconditionally adds `html.kiosk` on
	// localhost (which is always true under vite dev), which hides the cursor
	// via the global CSS rule in src/routes/+page.svelte. Strip the class in
	// dev so we can actually click sliders / drag the blind / open the panel.
	// Prod kiosk (bun serve on the Pi) is also localhost but NOT vite dev, so
	// the class survives and cursor stays hidden as intended.
	if (typeof window !== 'undefined' && import.meta.env.DEV) {
		document.documentElement.classList.remove('kiosk');
	}
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" />
</svelte:head>

{@render children()}

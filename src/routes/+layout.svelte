<script lang="ts">
	import '../app.css';

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
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossorigin="anonymous"
	/>
	<link
		href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children()}

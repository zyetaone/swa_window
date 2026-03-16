<script>
	let { children } = $props();
</script>

<svelte:head>
	<title>Aero Admin — Fleet Management</title>
	<meta name="description" content="Zyeta Aero Dynamic Window fleet management dashboard" />
</svelte:head>

{@render children()}

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		background: #0f1117;
		color: #e4e4e7;
		min-height: 100vh;
	}

	:global(button) {
		cursor: pointer;
		font-family: inherit;
	}

	:global(select, input) {
		font-family: inherit;
	}
</style>

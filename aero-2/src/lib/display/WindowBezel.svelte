<!-- WindowBezel — oval airplane window frame and inner depth shadow -->
<div class="window-bezel" aria-hidden="true">
	<div class="bezel-inner"></div>
</div>

<style>
	.window-bezel {
		position: absolute;
		inset: 0;
		box-shadow: inset 0 0 80px 40px rgba(0, 0, 0, 0.85);
		pointer-events: none;
	}

	.bezel-inner {
		position: absolute;
		inset: 12px;
		border-radius: 42px;
		border: 1.5px solid rgba(255, 255, 255, 0.08);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			0 0 0 12px rgba(18, 22, 28, 0.95);
	}
</style>

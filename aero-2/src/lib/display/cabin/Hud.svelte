<script lang="ts">
	/**
	 * Hud — Real-time telemetry, live FPS counter, flight instruments, and attribution status band.
	 * Positioned along the bottom bezel with glassmorphic styling.
	 */
	import { useDisplay } from '../display.svelte.js';
	import { TILE_ATTRIBUTION } from '#lib/settings/tiles.js';

	interface Props {
		visible?: boolean;
		showFps?: boolean;
	}

	let { visible = true, showFps = true }: Props = $props();

	const display = useDisplay();

	// Live FPS Counter state
	let fps = $state(60);
	let frameTimeMs = $state(16.6);

	$effect(() => {
		let raf: number;
		let lastTime = performance.now();
		let frameCount = 0;
		let lastFpsUpdate = lastTime;

		const countLoop = (now: number) => {
			frameCount++;
			const delta = now - lastTime;
			lastTime = now;

			if (now - lastFpsUpdate >= 500) {
				fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
				frameTimeMs = Number(delta.toFixed(1));
				frameCount = 0;
				lastFpsUpdate = now;
			}

			raf = requestAnimationFrame(countLoop);
		};

		raf = requestAnimationFrame(countLoop);
		return () => cancelAnimationFrame(raf);
	});

	function formatTime(hours: number): string {
		const h = Math.floor(hours) % 24;
		const m = Math.floor((hours % 1) * 60);
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
	}

	const aglM = $derived(Math.round(display.view.aglM ?? 0));
	const aglFt = $derived(Math.round(aglM * 3.28084));
	const heading = $derived(Math.round(display.view.planeHeadingDeg ?? 0));
	const bank = $derived(
		display.view.bankDeg !== undefined ? display.view.bankDeg.toFixed(1) : '0.0'
	);
	const localTime = $derived(formatTime(display.view.timeOfDay ?? 12));
	const band = $derived(display.atmosphere.bandId);
</script>

{#if visible}
	<aside class="hud-status-band" aria-label="Flight Telemetry and Attribution">
		<!-- Left: Performance & Flight Instrument Gauges -->
		<div class="hud-group left">
			{#if showFps}
				<div class="hud-pill fps-pill" class:smooth={fps >= 55} class:drop={fps < 45}>
					<span class="dot"></span>
					<strong>{fps} FPS</strong>
					<span class="subtext">{frameTimeMs}ms</span>
				</div>
			{/if}

			<div class="hud-pill telemetry-pill">
				<span class="label">ALT</span>
				<strong>{aglM} m</strong>
				<span class="subtext">({aglFt.toLocaleString()} ft)</span>
			</div>

			<div class="hud-pill telemetry-pill">
				<span class="label">HDG</span>
				<strong>{heading}°</strong>
			</div>

			<div class="hud-pill telemetry-pill">
				<span class="label">BANK</span>
				<strong>{bank}°</strong>
			</div>

			<div class="hud-pill telemetry-pill">
				<span class="label">TIME</span>
				<strong>{localTime}</strong>
			</div>

			<div class="hud-pill telemetry-pill">
				<span class="label">BAND</span>
				<strong>{band}</strong>
			</div>
		</div>

		<!-- Right: Data Attribution -->
		<div class="hud-group right">
			<div class="hud-pill attribution-pill" title={TILE_ATTRIBUTION}>
				<span class="attr-text">NASA GIBS · USGS 3DEP / NAIP · AWS Terrarium</span>
			</div>
		</div>
	</aside>
{/if}

<style>
	.hud-status-band {
		position: absolute;
		bottom: 12px;
		left: 16px;
		right: 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		pointer-events: none;
		user-select: none;
		z-index: 15;
		font-family: var(--font-sans);
		gap: 12px;
	}

	.hud-group {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.hud-pill {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		color: var(--text-primary);
		font-size: 0.75rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		pointer-events: auto;
	}

	.fps-pill strong {
		color: #4ade80;
		font-variant-numeric: tabular-nums;
	}
	.fps-pill.drop strong {
		color: #f87171;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #4ade80;
	}
	.fps-pill.drop .dot {
		background: #f87171;
	}

	.label {
		color: var(--accent-cyan);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.subtext {
		color: var(--text-muted);
		font-size: 0.68rem;
	}

	.attribution-pill {
		font-size: 0.68rem;
		color: var(--text-muted);
		border-color: var(--glass-border-subtle);
		background: rgba(15, 23, 42, 0.6);
	}

	@media (max-width: 768px) {
		.hud-status-band {
			flex-direction: column;
			align-items: flex-start;
			bottom: 8px;
			left: 8px;
			right: 8px;
		}
	}
</style>

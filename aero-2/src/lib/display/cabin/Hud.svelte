<script lang="ts">
	/**
	 * Hud — Real-time telemetry, live FPS monitor, flight instruments, and attribution status band.
	 * Rendered as a single sleek, continuous glassmorphism ribbon across the bottom edge.
	 */
	import { useDisplay } from '../display.svelte.js';
	import { TILE_ATTRIBUTION } from '#lib/settings/tiles.js';

	interface Props {
		visible?: boolean;
		showFps?: boolean;
	}

	let { visible = true, showFps = true }: Props = $props();

	const display = useDisplay();

	// Live FPS Counter state (driven from main simulation tick — zero extra RAF loops)
	const fps = $derived(display.fps);
	const frameTimeMs = $derived(display.frameTimeMs);

	/**
	 * The ribbon's real rendered height, republished as `--hud-height`.
	 *
	 * The contents wrap to two or three rows as the viewport narrows, so its
	 * height is not a constant. Anything stacked above it must clear the ACTUAL
	 * height; a hard-coded offset that clears one row overlaps at the next
	 * breakpoint, which is what the minimap did at 420 px wide.
	 */
	let ribbonHeight = $state(36);
	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.style.setProperty('--hud-height', `${visible ? ribbonHeight : 0}px`);
	});

	function formatTime(hours: number): string {
		const h = Math.floor(hours) % 24;
		const m = Math.floor((hours % 1) * 60);
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
	}

	/** 17.4435, 78.3772 -> "17.44N 78.38E". Signed degrees read as data; a
	 *  hemisphere letter reads as a position, which is what a window shows. */
	function formatCoord(lat: number, lon: number): string {
		const ns = lat >= 0 ? 'N' : 'S';
		const ew = lon >= 0 ? 'E' : 'W';
		return `${Math.abs(lat).toFixed(2)}${ns} ${Math.abs(lon).toFixed(2)}${ew}`;
	}

	const placeName = $derived(display.config.place.name);
	const coords = $derived(formatCoord(display.view.lat ?? 0, display.view.lon ?? 0));
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
	<!--
		Publishes its own height as `--hud-height` on the document root, so
		anything stacked above it (the minimap) clears the ACTUAL ribbon rather
		than a hard-coded guess. The ribbon wraps to two or three rows as the
		viewport narrows; a fixed offset that clears one row overlaps at the next
		breakpoint, which is exactly what happened.
	-->
	<aside
		class="hud-ribbon-bar"
		bind:clientHeight={ribbonHeight}
		aria-label="Flight Telemetry Ribbon"
	>
		<!-- Telemetry Sections -->
		<div class="ribbon-content">
			{#if showFps}
				<div class="hud-segment fps-segment" class:drop={fps < 45}>
					<span class="status-dot"></span>
					<span class="fps-val">{fps} FPS</span>
					<span class="ms-val">{frameTimeMs}ms</span>
				</div>
				<div class="divider"></div>
			{/if}

			<div class="hud-segment">
				<span class="seg-label">LOC</span>
				<strong class="seg-val">{placeName}</strong>
				<span class="seg-sub">{coords}</span>
			</div>

			<div class="divider"></div>

			<div class="hud-segment">
				<span class="seg-label">ALT</span>
				<strong class="seg-val">{aglM} m</strong>
				<span class="seg-sub">({aglFt.toLocaleString()} ft)</span>
			</div>

			<div class="divider"></div>

			<div class="hud-segment">
				<span class="seg-label">HDG</span>
				<strong class="seg-val">{heading}°</strong>
			</div>

			<div class="divider"></div>

			<div class="hud-segment">
				<span class="seg-label">BANK</span>
				<strong class="seg-val">{bank}°</strong>
			</div>

			<div class="divider"></div>

			<div class="hud-segment">
				<span class="seg-label">TIME</span>
				<strong class="seg-val">{localTime}</strong>
			</div>

			<div class="divider"></div>

			<div class="hud-segment">
				<span class="seg-label">BAND</span>
				<strong class="seg-val band-val">{band}</strong>
			</div>
		</div>

		<!-- Single Attribution Segment -->
		<div class="attribution-section" title={TILE_ATTRIBUTION}>
			<!-- The one attribution string. This was a hand-typed second copy that
			     already disagreed with TILE_ATTRIBUTION, and every added source
			     would have had to be remembered in two files. -->
			<span class="attr-text">{TILE_ATTRIBUTION}</span>
		</div>
	</aside>
{/if}

<style>
	.hud-ribbon-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		/* min-height, not height: the contents wrap to a second and third row at
		   narrow widths. A fixed 36px let them overflow the declared box, so
		   anything positioned above the ribbon could not know its real height. */
		min-height: 36px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 16px;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid rgba(255, 255, 255, 0.12);
		z-index: 20;
		user-select: none;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
	}

	.ribbon-content {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 100%;
	}

	.hud-segment {
		display: flex;
		align-items: center;
		gap: 5px;
		color: var(--text-primary);
		white-space: nowrap;
	}

	.divider {
		width: 1px;
		height: 14px;
		background: rgba(255, 255, 255, 0.15);
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #4ade80;
		box-shadow: 0 0 6px #4ade80;
	}

	.fps-segment.drop .status-dot {
		background: #f87171;
		box-shadow: 0 0 6px #f87171;
	}

	.fps-val {
		color: #4ade80;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.fps-segment.drop .fps-val {
		color: #f87171;
	}

	.ms-val {
		color: var(--text-muted);
		font-size: 0.65rem;
	}

	.seg-label {
		color: var(--accent-cyan);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.seg-val {
		color: #f8fafc;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.band-val {
		color: #38bdf8;
		text-transform: uppercase;
		font-size: 0.68rem;
		letter-spacing: 0.03em;
	}

	.seg-sub {
		color: var(--text-muted);
		font-size: 0.65rem;
	}

	.attribution-section {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		font-size: 0.65rem;
		letter-spacing: 0.02em;
		opacity: 0.85;
		white-space: nowrap;
	}

	.attribution-section:hover {
		opacity: 1;
		color: var(--text-primary);
	}

	@media (max-width: 900px) {
		.hud-ribbon-bar {
			height: auto;
			padding: 6px 12px;
			flex-direction: column;
			gap: 4px;
			align-items: flex-start;
		}
		.ribbon-content {
			flex-wrap: wrap;
			gap: 8px;
		}
		.divider {
			display: none;
		}
	}
</style>

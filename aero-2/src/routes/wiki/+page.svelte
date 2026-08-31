<script lang="ts">
	import {
		PRODUCT_NAME,
		PRODUCT_SHORT,
		PRODUCT_OWNER,
		ENGINEERED_BY,
		PRODUCT_STAGE,
		PRODUCT_YEAR,
		PRODUCT_CREDIT_BLURB
	} from '#lib/credits.js';
</script>

<svelte:head>
	<title>Wiki — {PRODUCT_SHORT}</title>
	<meta
		name="description"
		content="{PRODUCT_NAME} — architecture, terms of operation, lifecycle, and credits ({PRODUCT_OWNER} · {ENGINEERED_BY})"
	/>
</svelte:head>

<main class="wiki-container">
	<header class="hero">
		<h1>{PRODUCT_NAME}</h1>
		<p class="subtitle">Architecture · System Overview · Credits · Operations</p>
		<p class="blurb">{PRODUCT_CREDIT_BLURB}</p>
		<div class="meta-tags">
			{#if PRODUCT_STAGE}<span class="badge stage">{PRODUCT_STAGE}</span>{/if}
			<span class="badge">Svelte 5 Runes</span>
			<span class="badge">MapLibre GL</span>
			<span class="badge">Bun Runtime</span>
			<span class="badge">Raspberry Pi 5 Kiosk</span>
		</div>
	</header>

	<section class="section">
		<h2>System Architecture</h2>
		<div class="grid">
			<div class="card">
				<h3>1. One 3D Viewport</h3>
				<p>
					MapLibre GL over DEM terrain (GIBS imagery + Terrarium elevation), with VIIRS night lights
					ramped into the ground grade. A second engine lived here and was deleted: it never sampled
					terrain, so it flew the regional mean straight through five of the eleven locations.
				</p>
			</div>
			<div class="card">
				<h3>2. Zero-Drift Kinematics</h3>
				<p>
					Orbit trajectories derive from wall-clock seconds (UTC), eliminating accumulator
					frame-drop drift and ensuring multi-screen panoramic walls remain in permanent alignment.
				</p>
			</div>
			<div class="card">
				<h3>3. Pure 3D WebGL Wing Overlay</h3>
				<p>
					High-fidelity Boeing 737 3D model with direction-aware X-reflection, screen-space roll
					parity, and aviation-standard navigation lights (Starboard Green / Port Red).
				</p>
			</div>
			<div class="card">
				<h3>4. Circadian Atmosphere Engine</h3>
				<p>
					Astronomical solar zenith and azimuth calculations modulate Rayleigh scattering, mountain
					Igor hillshading, and day/night transitions in continuous real time.
				</p>
			</div>
		</div>
	</section>

	<section class="section">
		<h2>Operator & Fleet Hotkeys</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Key</th>
						<th>Action</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><kbd>S</kbd></td>
						<td>Settings Drawer</td>
						<td>Opens the tuning drawer with scene presets and camera controls</td>
					</tr>
					<tr>
						<td><kbd>A</kbd></td>
						<td>Diagnostics Overlay</td>
						<td>Shows the in-window telemetry overlay</td>
					</tr>
					<tr>
						<td><kbd>H</kbd></td>
						<td>Flight HUD</td>
						<td>Toggles the altitude, heading and destination readout</td>
					</tr>
					<tr>
						<td><kbd>B</kbd></td>
						<td>Blind Toggle</td>
						<td>Pulls down or raises the window blind</td>
					</tr>
					<tr>
						<td><kbd>R</kbd> / <kbd>Space</kbd></td>
						<td>Reverse Orbit</td>
						<td>Reverses flight direction and mirrors the 3D aircraft wing</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<footer class="footer">
		<p>{PRODUCT_NAME} &copy; {PRODUCT_YEAR} {PRODUCT_OWNER}. Engineered by {ENGINEERED_BY}.</p>
		<p><a href="/">← Return to Kiosk Flight Display</a></p>
	</footer>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #0b111e;
		color: #e2e8f0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}
	.wiki-container {
		max-width: 900px;
		margin: 0 auto;
		padding: 48px 24px;
	}
	.hero {
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		padding-bottom: 32px;
		margin-bottom: 40px;
	}
	h1 {
		font-size: 2.25rem;
		margin: 0 0 8px;
		color: #38bdf8;
		letter-spacing: -0.02em;
	}
	.subtitle {
		font-size: 1.1rem;
		color: #94a3b8;
		margin: 0 0 16px;
	}
	.blurb {
		font-size: 0.95rem;
		color: #cbd5e1;
		line-height: 1.6;
		margin: 0 0 20px;
	}
	.meta-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.badge {
		font-size: 0.75rem;
		padding: 4px 10px;
		border-radius: 9999px;
		background: rgba(56, 189, 248, 0.1);
		border: 1px solid rgba(56, 189, 248, 0.3);
		color: #38bdf8;
		font-weight: 500;
	}
	.badge.stage {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
		color: #f59e0b;
	}
	.section {
		margin-bottom: 48px;
	}
	h2 {
		font-size: 1.4rem;
		color: #f8fafc;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		padding-bottom: 10px;
		margin-bottom: 20px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.card {
		padding: 20px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
	}
	.card h3 {
		margin: 0 0 8px;
		font-size: 1rem;
		color: #38bdf8;
	}
	.card p {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #94a3b8;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		padding: 12px 16px;
		text-align: left;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	th {
		color: #94a3b8;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	kbd {
		display: inline-block;
		padding: 2px 6px;
		font-family: monospace;
		font-size: 0.8rem;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		color: #38bdf8;
	}
	.footer {
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		padding-top: 24px;
		color: #64748b;
		font-size: 0.85rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.footer a {
		color: #38bdf8;
		text-decoration: none;
	}
	.footer a:hover {
		text-decoration: underline;
	}
</style>

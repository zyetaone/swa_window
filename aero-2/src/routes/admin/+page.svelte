<script lang="ts">
	/**
	 * /admin — Fleet Management, Multi-Screen Remote Control Cockpit & Diagnostics.
	 */
	import { onMount } from 'svelte';
	import { PRODUCT_NAME, PRODUCT_OWNER, ENGINEERED_BY, PRODUCT_STAGE } from '#lib/credits.js';
	import { LOCATIONS } from '#lib/settings/locations.js';
	import { SCENE_PRESETS } from '#lib/settings/presets.js';

	/**
	 * Mirrors what /api/status ACTUALLY returns.
	 *
	 * The previous shape was invented — it declared `version`, `memory` and
	 * `network`, none of which the endpoint sends. That is not a harmless
	 * mismatch: `status?.memory.heapUsedMb` optional-chains the wrong link, so
	 * once the fetch resolved, `.memory` was undefined and reading
	 * `.heapUsedMb` threw during render. A throw in component init leaves an
	 * EMPTY BODY, so /admin returned 200 with 19 characters of text and no
	 * error anywhere except the browser console.
	 */
	interface NetworkStatus {
		online: boolean;
		hostname: string;
		uptimeSec: number;
		freeMemBytes: number;
		totalMemBytes: number;
		lanIps: { name: string; address: string; family: string }[];
		primaryLanIp: string | null;
		port: number;
	}

	let status = $state<NetworkStatus | null>(null);
	let activeRole = $state('center');
	let activeMode = $state('flight');
	let activePreset = $state('');
	let copiedLink = $state<string | null>(null);

	const origin = $derived(
		typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
	);

	onMount(() => {
		fetch('/api/status')
			.then((res) => res.json())
			.then((data) => {
				status = data;
			})
			.catch(() => {});
	});

	function copyToClipboard(text: string, label: string) {
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			navigator.clipboard.writeText(text);
			copiedLink = label;
			setTimeout(() => {
				copiedLink = null;
			}, 2500);
		}
	}
</script>

<svelte:head>
	<title>Admin & Fleet Cockpit — {PRODUCT_NAME}</title>
</svelte:head>

<main class="admin-cockpit">
	<header class="top-bar">
		<div>
			<h1>{PRODUCT_NAME} Cockpit</h1>
			<p class="subtitle">Multi-Screen Fleet Remote Control & System Diagnostics</p>
		</div>
		<div class="header-badges">
			{#if PRODUCT_STAGE}<span class="badge stage">{PRODUCT_STAGE}</span>{/if}
			<span class="badge online">SYSTEM ONLINE</span>
		</div>
	</header>

	<div class="dashboard-grid">
		<!-- Column 1: Multi-Screen Fleet Remote Launcher -->
		<section class="card">
			<h2>🖥️ Multi-Screen Panorama Displays</h2>
			<p class="card-desc">
				Launch continuous 3-screen panoramic windows or solo kiosk instances across local network
				devices.
			</p>

			<div class="display-roles-grid">
				{#each [{ role: 'left', title: 'Left Window Screen', desc: '-30° Yaw Offset Panorama', icon: '◀️' }, { role: 'center', title: 'Center Window Screen', desc: '0° Leader & Flight Director', icon: '⏺️' }, { role: 'right', title: 'Right Window Screen', desc: '+30° Yaw Offset Panorama', icon: '▶️' }, { role: 'solo', title: 'Solo Window Display', desc: 'Standalone Single Kiosk', icon: '🚀' }] as item}
					{@const roleUrl = `${origin}/?role=${item.role}`}
					<div class="role-card" class:active={activeRole === item.role}>
						<div class="role-header">
							<span class="role-icon">{item.icon}</span>
							<div>
								<div class="role-title">{item.title}</div>
								<div class="role-desc">{item.desc}</div>
							</div>
						</div>
						<div class="role-url-box">
							<code>{roleUrl}</code>
						</div>
						<div class="role-actions">
							<a href={roleUrl} target="_blank" rel="noreferrer" class="btn primary"
								>Launch Screen ↗</a
							>
							<button
								type="button"
								class="btn secondary"
								onclick={() => copyToClipboard(roleUrl, item.role)}
							>
								{copiedLink === item.role ? '✓ Copied URL!' : 'Copy URL'}
							</button>
						</div>
					</div>
				{/each}
			</div>

			{#if status?.lanIps && status.lanIps.length > 0}
				<div class="network-interfaces">
					<h3>Local LAN Access IP Addresses:</h3>
					<div class="ip-list">
						{#each status.lanIps as net}
							{@const ipUrl = `http://${net.address}:5173/`}
							<div class="ip-row">
								<span class="iface-name">{net.name}:</span>
								<code>{ipUrl}</code>
								<button
									type="button"
									class="btn xs"
									onclick={() => copyToClipboard(ipUrl, net.address)}
								>
									{copiedLink === net.address ? '✓ Copied' : 'Copy'}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- Column 2: Scene Presets & Remote Controls -->
		<section class="card">
			<h2>🎨 Scene Composition Presets</h2>
			<p class="card-desc">
				Push curated atmospheric, lighting, and terrain compositions to kiosks.
			</p>

			<div class="presets-list">
				{#each SCENE_PRESETS as preset}
					<a
						href="{origin}/?preset={preset.id}"
						target="_blank"
						rel="noreferrer"
						class="preset-card-admin"
					>
						<div class="preset-top">
							<span class="preset-icon">{preset.icon}</span>
							<span class="badge preset-badge">{preset.badge}</span>
						</div>
						<div class="preset-name">{preset.name}</div>
						<div class="preset-desc">{preset.description}</div>
					</a>
				{/each}
			</div>

			<h2 style="margin-top: 24px;">🌍 Global Destinations</h2>
			<div class="destinations-grid">
				{#each LOCATIONS as loc}
					<a href="{origin}/?place={loc.id}" target="_blank" rel="noreferrer" class="dest-btn">
						<span class="dest-name">{loc.name}</span>
						<span class="dest-elev">{loc.groundElevationM}m MSL</span>
					</a>
				{/each}
			</div>
		</section>
	</div>

	<!-- System Telemetry & Health -->
	<section class="card telemetry-section">
		<h2>⚡ Host Telemetry & Device Health</h2>
		<div class="telemetry-grid">
			<div class="telem-item">
				<span class="label">System Status</span>
				<!-- Reflects the probe, not a constant: a dashboard that always says
				     HEALTHY is decoration, not telemetry. -->
				<span class="val" class:green={status?.online} class:warn={!status?.online}>
					{status ? (status.online ? 'HEALTHY' : 'DEGRADED') : 'CONNECTING…'}
				</span>
			</div>
			<div class="telem-item">
				<span class="label">Host</span>
				<span class="val">{status?.hostname ?? 'unknown'}</span>
			</div>
			<div class="telem-item">
				<span class="label">Memory (used / total)</span>
				<span class="val"
					>{status ? Math.round((status.totalMemBytes - status.freeMemBytes) / 1048576) : 0} MB / {status
						? Math.round(status.totalMemBytes / 1048576)
						: 0} MB</span
				>
			</div>
			<div class="telem-item">
				<span class="label">Uptime</span>
				<span class="val">{Math.round((status?.uptimeSec ?? 0) / 60)} minutes</span>
			</div>
		</div>
	</section>

	<footer class="footer">
		<p>{PRODUCT_NAME} &copy; 2026 {PRODUCT_OWNER} · Engineered by {ENGINEERED_BY}.</p>
		<p><a href="/">← Return to Main Window Display</a> | <a href="/wiki">System Wiki →</a></p>
	</footer>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #090e17;
		color: #e2e8f0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}
	.admin-cockpit {
		max-width: 1280px;
		margin: 0 auto;
		padding: 32px 24px;
	}
	.top-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		padding-bottom: 24px;
		margin-bottom: 32px;
	}
	h1 {
		font-size: 1.85rem;
		margin: 0 0 6px;
		color: #38bdf8;
		letter-spacing: -0.02em;
	}
	.subtitle {
		margin: 0;
		font-size: 0.95rem;
		color: #94a3b8;
	}
	.header-badges {
		display: flex;
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
	.badge.online {
		background: rgba(34, 197, 94, 0.15);
		border-color: rgba(34, 197, 94, 0.4);
		color: #22c55e;
	}
	.dashboard-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		margin-bottom: 24px;
	}
	@media (max-width: 900px) {
		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}
	.card {
		padding: 24px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		backdrop-filter: blur(12px);
	}
	h2 {
		font-size: 1.25rem;
		margin: 0 0 8px;
		color: #f8fafc;
	}
	.card-desc {
		font-size: 0.85rem;
		color: #94a3b8;
		margin: 0 0 20px;
		line-height: 1.4;
	}
	.display-roles-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 20px;
	}
	.role-card {
		padding: 14px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.role-header {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.role-icon {
		font-size: 1.25rem;
	}
	.role-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #f1f5f9;
	}
	.role-desc {
		font-size: 0.7rem;
		color: #94a3b8;
	}
	.role-url-box {
		background: rgba(0, 0, 0, 0.3);
		padding: 6px 8px;
		border-radius: 6px;
		overflow: hidden;
	}
	.role-url-box code {
		font-size: 0.7rem;
		color: #38bdf8;
		white-space: nowrap;
	}
	.role-actions {
		display: flex;
		gap: 6px;
	}
	.btn {
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
		border: none;
	}
	.btn.primary {
		background: #0284c7;
		color: #ffffff;
	}
	.btn.primary:hover {
		background: #0369a1;
	}
	.btn.secondary {
		background: rgba(255, 255, 255, 0.08);
		color: #e2e8f0;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.btn.secondary:hover {
		background: rgba(255, 255, 255, 0.15);
	}
	.btn.xs {
		padding: 2px 8px;
		font-size: 0.7rem;
		background: rgba(255, 255, 255, 0.08);
		color: #e2e8f0;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}
	.network-interfaces {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 16px;
	}
	.network-interfaces h3 {
		margin: 0 0 10px;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #94a3b8;
	}
	.ip-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		background: rgba(0, 0, 0, 0.25);
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 0.75rem;
	}
	.iface-name {
		font-weight: 600;
		color: #94a3b8;
	}
	.ip-row code {
		color: #38bdf8;
		flex: 1;
	}
	.presets-list {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.preset-card-admin {
		padding: 10px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: all 0.15s ease;
	}
	.preset-card-admin:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(56, 189, 248, 0.4);
		transform: translateY(-1px);
	}
	.preset-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.preset-icon {
		font-size: 1.1rem;
	}
	.preset-badge {
		font-size: 0.6rem;
		padding: 1px 6px;
	}
	.preset-name {
		font-size: 0.8rem;
		font-weight: 600;
		color: #f1f5f9;
	}
	.preset-desc {
		font-size: 0.65rem;
		color: #94a3b8;
		line-height: 1.3;
	}
	.destinations-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.dest-btn {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		text-decoration: none;
		color: inherit;
		font-size: 0.75rem;
		transition: background 0.15s;
	}
	.dest-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(56, 189, 248, 0.3);
	}
	.dest-name {
		font-weight: 500;
		color: #f1f5f9;
	}
	.dest-elev {
		font-size: 0.65rem;
		color: #94a3b8;
	}
	.telemetry-section {
		margin-bottom: 32px;
	}
	.telemetry-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 16px;
	}
	.telem-item {
		background: rgba(0, 0, 0, 0.25);
		padding: 12px 16px;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.telem-item .label {
		font-size: 0.7rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.telem-item .val {
		font-size: 1rem;
		font-weight: 600;
		color: #f1f5f9;
	}
	.telem-item .val.green {
		color: #22c55e;
	}
	.footer {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
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

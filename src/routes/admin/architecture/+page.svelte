<script lang="ts">
</script>

<svelte:head>
	<title>Architecture — Aero Admin</title>
</svelte:head>

<main>
	<a href="/admin" class="back-link">← Back to Admin</a>

	<article>
		<header>
			<h1>Architecture</h1>
			<p class="sub">Living sources of truth — the code is the spec.</p>
		</header>

		<section>
			<h2>Where the architecture lives</h2>
			<ul>
				<li>
					<code>CLAUDE.md</code>
					— invariants, tick pipeline, phase history.
				</li>
				<li>
					<code>docs/reference/</code> — integration recipes (takram atmosphere, Cesium OSM styling).
				</li>
				<li>
					<code>docs/CODEMAPS/</code> — per-concern maps.
				</li>
				<li>
					<code>docs/ADR-001-offline-tile-architecture.md</code> + <code>ADR-002-zero-cost-caching-strategy.md</code>
					— Pi-5-fleet offline-tile pipeline decisions.
				</li>
				<li>
					<code>graphify-out/graph.html</code>
					— interactive force-directed code graph (run <code>graphify src</code> to refresh).
				</li>
			</ul>
		</section>

		<section>
			<h2>The three invariants</h2>
			<ol>
				<li>
					<strong>Cesium isolation</strong> — <code>cesium</code> is imported only inside
					<code>src/lib/world/</code>. Verify with <code>rg "from 'cesium'" src/lib/</code> — expect two
					hits, both in <code>world/</code>.
				</li>
				<li>
					<strong>Path-keyed config + LWW-CRDT boundary</strong> — every config mutation flows through
					<code>applyConfigPatch(path, value, remote?)</code>. Called with no third arg it stamps locally;
					called with <code>&#123;timestamp, sourceId&#125;</code> it CRDT-merges (per-path last-writer-wins,
					sourceId tiebreak). <code>applyPatch(DTO)</code> is a thin adapter that decomposes flat scene DTOs
					into typed setters + <code>applyConfigPatch</code>.
				</li>
				<li>
					<strong><code>untrack()</code> in hot paths</strong> — every engine tick body (flight, motion,
					director) and the Window.svelte RAF subscriber wrap work in <code>untrack()</code> so 60 Hz reads
					don't build reactive dependencies across the graph.
				</li>
			</ol>
		</section>

		<section>
			<h2>Fleet topology — REST + SSE, no central broker</h2>
			<p>
				Six Pis on an office LAN. Admin talks to each device directly over HTTP; each device's browser
				subscribes to its own SvelteKit-served SSE stream. No long-lived connections between admin and
				devices.
			</p>
			<pre class="pipeline">admin-browser ──PATCH /api/config ──▶ device-pi Node ──publish()──▶ sse-bus
                                                                   │
                                                                   ▼
device-browser ◀── EventSource /api/events ◀─── subscribe() ──────┘

admin-browser ──GET /api/devices ──▶  mDNS peer list (from lan-peers.server)
admin-browser ──POLL /api/status──▶  per-device cached status (updated by
                                     device browser POST /api/status @ 5s)
leader-device ──POST /api/command──▶ follower-pi (director_decision etc.)</pre>
			<ul>
				<li>
					<code>/api/config</code> PATCH — config patch, CRDT-merged when <code>&#123;timestamp, sourceId&#125;</code> set.
				</li>
				<li>
					<code>/api/command</code> POST — one-shot commands (<code>set_scene</code>, <code>set_mode</code>,
					<code>set_config</code>, <code>director_decision</code>, <code>role_assign</code>).
				</li>
				<li>
					<code>/api/events</code> GET (SSE) — same-origin stream for the local browser.
				</li>
				<li>
					<code>/api/status</code> GET (admin polls) / POST (browser heartbeat @ 5 s).
				</li>
				<li>
					<code>/api/devices</code> GET — mDNS peer list + self.
				</li>
			</ul>
		</section>

		<section>
			<h2>Module map</h2>
			<div class="module-grid">
				<div class="module-card">
					<h3>model/</h3>
					<p>AeroWindow class, flat config tree + CRDT store, persistence, frame telemetry.</p>
				</div>
				<div class="module-card">
					<h3>world/</h3>
					<p>CesiumManager — the only module that imports <code>cesium</code>. Terrain, imagery, VIIRS, buildings, post-process. <code>auto-quality.ts</code> is pure.</p>
				</div>
				<div class="module-card">
					<h3>night/</h3>
					<p>Barrel hub for night-rendering pipeline — sky-state utils + color-grading GLSL + VIIRS/night-map thresholds.</p>
				</div>
				<div class="module-card">
					<h3>camera/</h3>
					<p>FlightSimEngine (orbit + cruise FSM) is a class. <code>motion.svelte.ts</code> is a module — reactive <code>motion</code> object + <code>motionStep()</code>.</p>
				</div>
				<div class="module-card">
					<h3>director/</h3>
					<p>Module of pure functions — <code>directorTick()</code> + <code>directorReset()</code>. Leader-only (solo/center). Scenarios in <code>scenarios.ts</code>.</p>
				</div>
				<div class="module-card">
					<h3>atmosphere/</h3>
					<p>Clouds (ArtsyClouds CSS3D), weather (rain + frost + lightning), micro-events, haze. Each effect registered in <code>scene/registry.ts</code>.</p>
				</div>
				<div class="module-card">
					<h3>scene/</h3>
					<p>Compositor, registry, <code>layers.ts</code> (Z-order SSOT), bundle system (install/remove/reconcile), car-lights effect.</p>
				</div>
				<div class="module-card">
					<h3>shell/</h3>
					<p>Window frame, HUD, SidePanel (typed setters), Blind (one gesture: pull → fly to new location).</p>
				</div>
				<div class="module-card">
					<h3>fleet/</h3>
					<p>SSE client (device browser), REST admin store, SSE bus + status registry (server-side), parallax role math, mDNS peers, LAN bundle cache.</p>
				</div>
			</div>
		</section>

		<section>
			<h2>Tick pipeline</h2>
			<pre class="pipeline">Window.svelte $effect(untrack(() =&gt; …))
└── game-loop.subscribe (RAF 60 Hz)
    └── model.tick(delta)
        ├── flight.tick(delta, ctx)   → FlightPatch
        ├── motionStep(delta, ctx)    → mutates motion.*
        ├── directorTick(delta, ctx)  → WorldPatch  [leader only]
        └── #tickAutoQuality(delta)   → nextQualityMode(fps, current)</pre>
			<p>
				Scene effects (lightning timer, micro-events) schedule independently — not driven by
				<code>model.tick()</code>. Effect-side teardown guards for HMR via <code>viewer.isDestroyed?.()</code>.
			</p>
		</section>

		<section>
			<h2>Multi-Pi parallax (Phase 7)</h2>
			<p>
				Three Pis side-by-side form one continuous panoramic window. Role: URL param →
				<code>localStorage</code> binding → default <code>'solo'</code>. Leader runs the director; followers
				apply <code>director_decision</code> commands at a shared wall-clock
				<code>transitionAtMs</code> so all three flip simultaneously.
			</p>
			<table class="role-table">
				<thead>
					<tr><th>Role</th><th>Offset</th><th>Frame</th><th>Autopilot</th></tr>
				</thead>
				<tbody>
					<tr><td><code>solo</code></td><td>0°</td><td>on</td><td>leader</td></tr>
					<tr><td><code>center</code></td><td>0°</td><td>off</td><td>leader</td></tr>
					<tr><td><code>left</code></td><td>−(arc/2−arc/6)°</td><td>off</td><td>follower</td></tr>
					<tr><td><code>right</code></td><td>+(arc/2−arc/6)°</td><td>off</td><td>follower</td></tr>
				</tbody>
			</table>
			<p class="note">
				Leader-to-follower broadcast is wired: each device's SSE client caches its peer list from
				<code>/api/devices</code> (refreshed every 30 s) and <code>publishV2</code> fires fire-and-forget
				POSTs to every peer's <code>/api/command</code>. Followers schedule the flyTo at
				<code>transitionAtMs</code> so all Pis flip together.
			</p>
		</section>

		<section>
			<h2>Recent cleanup (Apr 24 session)</h2>
			<ul>
				<li>One gesture: blind-pull → fly-to-new-location. Deleted tap-to-fly + long-press speed boost (~80 lines).</li>
				<li>Pure functions off AeroWindow: <code>dawnDuskFactor</code> / <code>smoothstep</code> → <code>utils</code>, <code>effectiveCloudDensity</code> → <code>atmosphere/clouds/rules</code>, <code>nextQualityMode</code> → <code>world/auto-quality</code>.</li>
				<li>Four shim getters removed from AeroWindow — callers read <code>model.config.*</code> directly.</li>
				<li>Motion + Director engines: class → module. ~30 lines saved plus one allocation per AeroWindow.</li>
				<li><code>scene/layers.ts</code> — named Z constants. Replaced triplicated z-order docs.</li>
				<li><code>lan-proxy.server.ts</code> split into <code>lan-peers</code> + <code>lan-bundle-cache</code>.</li>
				<li><code>night/</code> barrel exposing VIIRS / haze / color-grading constants in one place.</li>
				<li>CRDT wiring finished: <code>applyConfigPatch(path, value, remote?)</code> — one function, optional timestamp+sourceId tiebreak.</li>
				<li>WS fleet broker deleted: <code>hub.ts</code>, <code>admin.svelte.ts</code>, <code>transport.svelte.ts</code>, <code>url.ts</code>, <code>routes/api/fleet/+server.ts</code>, v1/v2 wire-message unions. ~1100 lines gone.</li>
			</ul>
		</section>

		<footer>
			<p>
				The old 1,921-line static layer-stack page (pre-<code>970c146</code>) is in git history. This page
				tracks the current shape. Edit in place as the code evolves.
			</p>
		</footer>
	</article>
</main>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 32px 24px 80px;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		color: #e8eef7;
		background: #04060d;
		min-height: 100vh;
	}
	.back-link {
		display: inline-block;
		margin-bottom: 24px;
		color: #71717a;
		text-decoration: none;
		font-size: 13px;
		transition: color 0.15s;
	}
	.back-link:hover { color: #a1a1aa; }
	h1 {
		font-size: 28px;
		margin: 0 0 6px;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0 0 32px;
		color: rgba(232, 238, 247, 0.55);
		font-size: 13px;
	}
	h2 {
		font-size: 13px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgba(232, 238, 247, 0.6);
		margin: 32px 0 12px;
	}
	section + section {
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		padding-top: 20px;
	}
	ul, ol, p {
		line-height: 1.65;
		font-size: 13px;
		color: rgba(232, 238, 247, 0.8);
	}
	ul, ol { padding-left: 20px; }
	li + li { margin-top: 6px; }
	.note {
		color: rgba(232, 238, 247, 0.55);
		font-size: 12px;
		margin-top: 10px;
		font-style: italic;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 12px;
		color: rgb(160, 190, 255);
	}
	.module-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.module-card {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 12px 14px;
	}
	.module-card h3 {
		font-size: 12px;
		font-weight: 600;
		color: #e4e4e7;
		margin: 0 0 4px;
		font-family: ui-monospace, monospace;
	}
	.module-card p {
		font-size: 12px;
		color: #71717a;
		margin: 0;
		line-height: 1.5;
	}
	pre.pipeline {
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		padding: 12px 16px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #a1a1aa;
		overflow-x: auto;
		line-height: 1.6;
	}
	.role-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.role-table th {
		text-align: left;
		color: #71717a;
		font-weight: 500;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 6px 10px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.role-table td {
		padding: 6px 10px;
		color: #a1a1aa;
	}
	.role-table tr + tr td { border-top: 1px solid rgba(255, 255, 255, 0.03); }
	footer {
		margin-top: 40px;
		font-size: 11px;
		color: rgba(232, 238, 247, 0.3);
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		padding-top: 16px;
	}
</style>

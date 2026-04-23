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
					— invariants (Cesium isolation, flat DTO boundary, <code>untrack()</code> in hot paths), the tick
					pipeline, and the full phase history.
				</li>
				<li>
					<code>docs/reference/</code>
					— integration recipes. Notably
					<code>takram-atmosphere-recipe.md</code>
					(archived but rebuildable) and
					<code>cesium-osm-buildings-styling.md</code>.
				</li>
				<li>
					<code>docs/CODEMAPS/</code> — per-concern maps: scene, content-api, security, files.
				</li>
				<li>
					<code>docs/ADR-001-offline-tile-architecture.md</code> + <code>ADR-002-zero-cost-caching-strategy.md</code>
					— the decisions behind the Pi-5-fleet offline-tile pipeline.
				</li>
			</ul>
		</section>

		<section>
			<h2>The three invariants</h2>
			<ol>
				<li>
					<strong>Cesium isolation</strong> — <code>cesium</code> only imported inside
					<code>src/lib/world/</code>. Everything else is Cesium-free and unit-testable.
				</li>
				<li>
					<strong>Flat DTO boundary</strong> —
					<code>model.applyConfigPatch(path, value)</code> and the fleet v1/v2 protocols cross the wire and
					<code>localStorage</code> as flat DTOs. Persistence and fleet back-compat depend on this.
				</li>
				<li>
					<strong><code>untrack()</code> in hot paths</strong> — every engine's <code>tick()</code> body wraps
					its work in <code>untrack()</code> so 60 Hz config reads don't build reactive dependencies across the
					graph.
				</li>
			</ol>
		</section>

		<section>
			<h2>Module map</h2>
			<div class="module-grid">
				<div class="module-card">
					<h3>model/</h3>
					<p>AeroWindow root (<code>aero-window.svelte.ts</code>), CRDT store, flat config tree, frame telemetry.</p>
				</div>
				<div class="module-card">
					<h3>world/</h3>
					<p>CesiumManager — terrain, imagery, buildings, atmosphere, post-processing. The only module that imports <code>cesium</code>.</p>
				</div>
				<div class="module-card">
					<h3>camera/</h3>
					<p>FlightSimEngine (orbit + cruise FSM) and MotionEngine (turbulence, banking, breathing, vibe).</p>
				</div>
				<div class="module-card">
					<h3>director/</h3>
					<p>DirectorEngine — autopilot location/weather randomizer. Only runs on solo/center (leader) devices.</p>
				</div>
				<div class="module-card">
					<h3>atmosphere/</h3>
					<p>Cloud blobs, weather effects (rain/frost/lightning), micro-events (stars/birds/contrails), haze.</p>
				</div>
				<div class="module-card">
					<h3>shell/</h3>
					<p>Window compositor, HUD, SidePanel, Blind, glass vignette, wing silhouette.</p>
				</div>
				<div class="module-card">
					<h3>scene/</h3>
					<p>Effect registry, compositor, bundle store (install/remove/reconcile), and scene effects (car-lights, video-bg, sprite).</p>
				</div>
				<div class="module-card">
					<h3>fleet/</h3>
					<p>Protocol v1/v2, WS/SSE transport, Display WS client, Admin store, fleet hub server, parallax role binding.</p>
				</div>
			</div>
		</section>

		<section>
			<h2>Tick pipeline</h2>
			<pre class="pipeline">game-loop.ts (RAF loop)
└── model.tick(delta)
    ├── FlightSimEngine.tick() → FlightPatch
    ├── MotionEngine (pure function)
    ├── DirectorEngine.tick() → WorldPatch  [leader only]
    └── Telemetry.recordFrame()</pre>
			<p>
				Scene effects (lightning timer, micro-event scheduler) manage their own timers independently —
				they are NOT driven by <code>model.tick()</code>.
			</p>
		</section>

		<section>
			<h2>Multi-Pi parallax (Phase 7)</h2>
			<p>
				Three Pis side-by-side form one continuous panoramic window. Same shared state; per-device camera yaw.
				Role assignment: URL param → localStorage binding → default <code>'solo'</code>.
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
		</section>

		<section>
			<h2>Interactive code graph</h2>
			<p>
				For a navigable view of the module structure, run <code>graphify .</code> at the project root. It produces
				<code>graphify-out/graph.html</code> — a force-directed graph with labeled communities.
			</p>
		</section>

		<footer>
			<p>
				Replaced a 1,921-line static layer-stack mock-up that drifted out of sync during the 2026-04
				Cesium consolidation. Git history preserves the old version (pre-commit <code>970c146</code>).
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
		line-height: 1.8;
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
<script lang="ts">
	/**
	 * /architecture — thin stub.
	 *
	 * Replaced a 1,921-line static mock-up (accurate circa 2026-02) that
	 * drifted out of sync with the code during the playground/Cesium/VIIRS
	 * refactors. Rather than re-write the whole thing by hand, this page
	 * now points to the living sources of architectural truth:
	 *
	 *   • CLAUDE.md                    — invariants, tick pipeline, phase history
	 *   • docs/reference/              — takram-atmosphere recipe, Cesium OSM styling, STATE_API
	 *   • docs/CODEMAPS/               — per-concern module maps
	 *   • docs/ADR-001, ADR-002        — zero-cost offline tiles decision
	 *   • graphify-out/graph.html      — interactive code graph (run `graphify .`)
	 *
	 * If you want a visual layer-stack explorer back, the old version is in
	 * git history — last clean snapshot at commit 970c146^ (before
	 * 2026-04-23). Rebuild from there when the code shape stabilises.
	 */
</script>

<main>
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
			<h2>Interactive code graph</h2>
			<p>
				For a navigable view of the module structure, run <code>graphify .</code> at the project root. It produces
				<code>graphify-out/graph.html</code> — a force-directed graph with labeled communities, hover tooltips for
				edges (EXTRACTED vs INFERRED), and a search box.
			</p>
		</section>

		<footer>
			<p>
				This page replaces a 1,921-line static layer-stack mock-up that drifted out of sync during the 2026-04
				Cesium consolidation. Git history preserves the old version (pre-commit <code>970c146</code>).
			</p>
		</footer>
	</article>
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 48px 24px 80px;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		color: #e8eef7;
		background: #04060d;
		min-height: 100vh;
	}
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
		font-size: 15px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: rgba(232, 238, 247, 0.7);
		margin: 32px 0 10px;
	}
	section + section {
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		padding-top: 20px;
	}
	ul,
	ol {
		padding-left: 20px;
		line-height: 1.65;
		font-size: 13px;
		color: rgba(232, 238, 247, 0.85);
	}
	li + li {
		margin-top: 8px;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 12px;
		color: rgb(160, 190, 255);
	}
	footer {
		margin-top: 40px;
		font-size: 11px;
		color: rgba(232, 238, 247, 0.35);
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		padding-top: 16px;
	}
	p {
		line-height: 1.6;
		color: rgba(232, 238, 247, 0.8);
	}
</style>

<script lang="ts">
	// Static project wiki — architecture, terms, lifecycle. No app context needed.
</script>

<svelte:head>
	<title>Wiki — Aero Window</title>
	<meta
		name="description"
		content="Aero Dynamic Window — architecture, operating terms, and product lifecycle"
	/>
</svelte:head>

<main class="arch-doc">
	<!-- ═══════════════════════════════════════════════════════════════ HERO -->
	<header class="hero">
		<h1>Aero Window</h1>
		<p class="subtitle">Wiki — Architecture, Terms &amp; Lifecycle</p>
		<p class="deck">A circadian-aware digital airplane window. Seven pillars built. Two more hiding in plain sight — Time and Networking, doing real work with no owner.</p>
		<div class="hero-meta">
			<span>SvelteKit 2 + Svelte 5 Runes</span>
			<span>Cesium + WebGL</span>
			<span>Bun Runtime</span>
			<span>Raspberry Pi 5 Kiosk</span>
		</div>
	</header>

	<!-- ═══════════════════════════════════════════════════════════════ PILLARS -->
	<section>
		<h2>The 7 Pillars</h2>
		<div class="pillar-grid">
			<div class="pillar-card built">
				<span class="pillar-num">1</span>
				<h3>Game Loop</h3>
				<p>Single RAF heartbeat. Visibility-aware. Error-resilient.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">2</span>
				<h3>State</h3>
				<p>Flat $state tree. CRDT sync across 6 Pis. One setByPath.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">3</span>
				<h3>Rendering</h3>
				<p>Z-layered compositor. Cesium WebGL → CSS effects → glass chrome.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">4</span>
				<h3>Camera</h3>
				<p>Orbit + cruise. Warp transitions. Six motion layers.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">5</span>
				<h3>Input</h3>
				<p>One passenger gesture: pull the blind. Everything else is operator surface.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">6</span>
				<h3>Content</h3>
				<p>Authorable by non-engineers. 12 locations. 21 scenarios.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card built">
				<span class="pillar-num">7</span>
				<h3>The Night</h3>
				<p>Five rendering stages. Smoothstep gates. The viewer never sees a transition.</p>
				<span class="badge">built</span>
			</div>
			<div class="pillar-card hidden">
				<span class="pillar-num">8</span>
				<h3>Time</h3>
				<p>Six consumers, no owner. Drives every smoothstep night gate.</p>
				<span class="badge">hidden</span>
			</div>
			<div class="pillar-card hidden">
				<span class="pillar-num">9</span>
				<h3>Networking</h3>
				<p>REST + SSE + CRDT + mDNS. Buried under "State." The field-failure pillar.</p>
				<span class="badge">hidden</span>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ ARCHITECTURE -->
	<section>
		<h2>Engine Architecture — Five Layers</h2>
		<p class="hidden-blurb">AeroWindow is a real-time engine, not an SPA. The architecture follows Svelte 5's reactive model above Cesium's native render graph — state and computation in runes, synchronisation into Cesium via <code>$effect</code>, only one imperative subsystem (the Flight Engine).</p>
		<div class="arch-stack">
			<div class="arch-layer title">
				<span>SvelteKit Application</span>
				<span class="arch-sub">+layout · +page · Pane · HUD · Settings · Telemetry</span>
			</div>
			<div class="arch-layer svelte">
				<span>Svelte 5 Reactive Model</span>
				<span class="arch-sub">$state · $derived · $effect</span>
			</div>
			<div class="arch-layer cesium">
				<span>Cesium Native Engine</span>
				<span class="arch-sub">Viewer · Scene · Terrain · Imagery · Buildings · Atmosphere · PostProcess</span>
			</div>
			<div class="arch-layer data">
				<span>Open Data Sources</span>
				<span class="arch-sub">Copernicus DEM · Sentinel-2 · VIIRS · OSM Buildings · Open-Meteo</span>
			</div>
			<div class="arch-layer gpu">
				<span>WebGL</span>
			</div>
		</div>
		<div class="ownership-grid">
			<div class="ownership-card">
				<h4>Model</h4>
				<p>Owns application state. Configuration, flight, weather, lighting. It never renders.</p>
			</div>
			<div class="ownership-card">
				<h4>World</h4>
				<p>Owns Earth. Terrain, imagery, atmosphere, buildings, night lights. It never decides <em>where</em> to fly.</p>
			</div>
			<div class="ownership-card">
				<h4>Camera</h4>
				<p>Owns movement. Camera pose, bank, parallax, seat-look frame. Nothing visual.</p>
			</div>
			<div class="ownership-card">
				<h4>Flight</h4>
				<p>Owns behaviour. Pick location, change weather, advance time, start flyover. Imperative — simulation isn't reactive.</p>
			</div>
			<div class="ownership-card">
				<h4>Scene</h4>
				<p>Owns decorative effects. Car lights, clouds, video bundles. Independent of Cesium.</p>
			</div>
			<div class="ownership-card">
				<h4>Shell</h4>
				<p>Owns presentation. Window frame, glass, wing, HUD, panels. Independent of simulation.</p>
			</div>
		</div>
		<div class="detail-box note">
			<h4>○ Single-Viewer Rule</h4>
			<p>Exactly one Cesium <code>Viewer</code> per process. The only call site is <code>src/lib/world/CesiumViewer.svelte</code>. A second Viewer doubles GPU memory and produces no coherent compositing result. If you think you need a second canvas, design a different pattern — not a second Viewer.</p>
		</div>
		<p class="arch-footer-line">See <code>docs/ARCHITECTURE.md</code> for the full architecture document, including the manager-to-feature migration map.</p>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ GAME LOOP -->
	<section>
		<h2>Pillar 1 — The Game Loop</h2>
		<div class="flow-diagram">
			<div class="flow-node root">requestAnimationFrame<div class="flow-sub">60 Hz heartbeat</div></div>
			<div class="flow-arrow">↓ dt</div>
			<div class="flow-node">model.tick(dt)<div class="flow-sub">flight · motion · director · auto-quality</div></div>
			<div class="flow-arrow">↓</div>
			<div class="flow-node">Svelte $derived<div class="flow-sub">re-computes only what changed</div></div>
			<div class="flow-arrow">↓</div>
			<div class="flow-row">
				<div class="flow-node">Cesium render<div class="flow-sub">WebGL globe</div></div>
				<span class="flow-plus">+</span>
				<div class="flow-node">Compositor<div class="flow-sub">Z-layered DOM</div></div>
				<span class="flow-plus">+</span>
				<div class="flow-node">CSS motion<div class="flow-sub">transforms</div></div>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ Solid</h4>
				<ul>
					<li>Single RAF source — no competing timers</li>
					<li>Visibility-aware — pauses when tab hidden</li>
					<li>dt clamped to 0.1s — prevents spiral-of-death</li>
					<li>10 consecutive errors → emergency reload</li>
				</ul>
			</div>
			<div class="detail-box note">
				<h4>○ Note</h4>
				<ul>
					<li>Variable timestep — fine for locked-refresh kiosk</li>
					<li>Fixed-timestep accumulator would help variable-rate displays</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ STATE -->
	<section>
		<h2>Pillar 2 — State</h2>
		<div class="state-diagram">
			<div class="state-box root-state">
				<div class="state-label">config ($state)</div>
				<div class="state-namespaces">
					<span>atmosphere</span><span>camera</span><span>director</span><span>world</span><span>shell</span>
				</div>
			</div>
			<div class="flow-arrow">↓ setByPath + CRDT</div>
			<div class="state-box">
				<div class="state-label">AeroWindow</div>
				<div class="state-namespaces">
					<span>location</span><span>timeOfDay</span><span>weather</span><span>$derived</span>
				</div>
			</div>
			<div class="flow-arrow">↓ Svelte context DI</div>
			<div class="state-row">
				<div class="state-box small">Pane</div>
				<div class="state-box small">Blind</div>
				<div class="state-box small">HUD</div>
				<div class="state-box small">Compositor</div>
				<div class="state-box small">SidePanel</div>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ Solid</h4>
				<ul>
					<li>One flat config tree — no nested stores, no Redux</li>
					<li>setByPath('atmosphere.clouds.density', 0.5) — one function writes anywhere</li>
					<li>CRDT LWW timestamps → fleet sync across 6 Pis with no central server</li>
					<li>Prototype-pollution hardened (__proto__ / constructor / prototype rejected)</li>
					<li>Content/control split: content/ vs src/ at filesystem level</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ RENDERING -->
	<section>
		<h2>Pillar 3 — Rendering (Z-Layer Stack)</h2>
		<div class="z-stack">
			<div class="z-layer" style="--z:11; --alpha:0.12">
				<span class="z-num">z:11</span>
				<span class="z-name">glass-recess</span>
				<span class="z-desc">rim depth shadow — creates the window frame illusion</span>
			</div>
			<div class="z-layer" style="--z:10; --alpha:0.14">
				<span class="z-num">z:10</span>
				<span class="z-name">vignette</span>
				<span class="z-desc">soft dark corners — draws eye to center</span>
			</div>
			<div class="z-layer" style="--z:9; --alpha:0.16">
				<span class="z-num">z:9</span>
				<span class="z-name">glass-vignette</span>
				<span class="z-desc">darkens rim perimeter — reinforces depth</span>
			</div>
			<div class="z-layer wing" style="--z:7; --alpha:0.22">
				<span class="z-num">z:7</span>
				<span class="z-name">wing silhouette</span>
				<span class="z-desc">dark gradient, bank-shifted — grounds the view</span>
			</div>
			<div class="z-layer frost" style="--z:5; --alpha:0.28">
				<span class="z-num">z:5</span>
				<span class="z-name">frost overlay</span>
				<span class="z-desc">altitude-gated ice crystals at 25K–40K ft</span>
			</div>
			<div class="z-layer micro" style="--z:3; --alpha:0.34">
				<span class="z-num">z:3</span>
				<span class="z-name">micro-events</span>
				<span class="z-desc">birds, shooting stars, contrails — moments of surprise</span>
			</div>
			<div class="z-layer storm" style="--z:2; --alpha:0.40">
				<span class="z-num">z:2</span>
				<span class="z-name">lightning + rain</span>
				<span class="z-desc">radial-gradient flash, CSS streak layers</span>
			</div>
			<div class="z-layer clouds" style="--z:1; --alpha:0.46">
				<span class="z-num">z:1</span>
				<span class="z-name">cloud sprites</span>
				<span class="z-desc">CSS3D / ArtsyClouds — weather-tuned density</span>
			</div>
			<div class="z-layer cesium" style="--z:0; --alpha:0.55">
				<span class="z-num">z:0</span>
				<span class="z-name">Cesium × WebGL</span>
				<span class="z-desc">terrain · OSM buildings · NASA VIIRS night lights · car-lights billboards</span>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ Solid</h4>
				<ul>
					<li>Single Z-source: layers.ts — imported by all consumers</li>
					<li>Single compositor mount point: &lt;Compositor /&gt; in Pane.svelte</li>
					<li>Static registry + dynamic bundle store merged at render time</li>
					<li>Adding an effect = 3 files: component, registry entry, z-constant</li>
					<li>CSS filter chain (blur/contrast/saturate) over WebGL — two rendering worlds that composite, not fight</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ CAMERA -->
	<section>
		<h2>Pillar 4 — Camera &amp; Motion</h2>
		<div class="camera-compare">
			<div class="camera-mode">
				<h3>Orbit Mode</h3>
				<div class="camera-viz orbit-viz">
					<div class="orbit-ring"></div>
					<div class="orbit-dot"></div>
				</div>
				<ul>
					<li>Elliptical path around city center</li>
					<li>Breathes in/out — 180s cycle</li>
					<li>Drifts at 1.4× speed</li>
					<li>Heading wanders via 3 sines</li>
					<li>Altitude seeks night vs day target</li>
				</ul>
			</div>
			<div class="camera-arrow">blind pull →</div>
			<div class="camera-mode">
				<h3>Cruise Mode</h3>
				<div class="camera-viz cruise-viz">
					<div class="cruise-trail"></div>
					<div class="cruise-dot"></div>
				</div>
				<ul>
					<li>Warp departure: smoothstep to 100× speed</li>
					<li>Blind CLOSES during transit</li>
					<li>CSS blur peaks at warpFactor × 5px</li>
					<li>2s transit → blind OPENS at destination</li>
					<li>Director resets, new scenario chosen</li>
				</ul>
			</div>
		</div>
		<div class="motion-grid">
			<div class="motion-card"><h4>Engine Vibe</h4><p>7Hz + 11Hz detuned<br/>0.35px amplitude<br/>Never repeats</p></div>
			<div class="motion-card"><h4>Turbulence</h4><p>Multi-octave noise<br/>Discrete bumps + ring decay<br/>Weather-scaled (1×–3×)</p></div>
			<div class="motion-card"><h4>Banking</h4><p>Heading delta → bank<br/>2.5× smoothing<br/>Max 6° tilt</p></div>
			<div class="motion-card"><h4>Breathing</h4><p>22s pitch oscillation<br/>±1.5°<br/>Prevents screenshot feel</p></div>
			<div class="motion-card"><h4>Altitude Seek</h4><p>Drifts to night/day target<br/>0.1× rate<br/>Night: lower over cities</p></div>
			<div class="motion-card"><h4>Frost</h4><p>25K–40K ft fade-in<br/>Ice crystal overlay<br/>Breathes at 8s cycle</p></div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ INPUT -->
	<section>
		<h2>Pillar 5 — Input</h2>
		<div class="input-focus">
			<div class="input-hero">
				<span class="gesture-icon">🪟</span>
				<h3>The Blind</h3>
				<p class="big-gesture">Drag down → close blind → fly somewhere new</p>
			</div>
			<div class="input-details">
				<div class="input-item"><strong>Primary</strong> Drag the pull-down shade</div>
				<div class="input-item"><strong>Keyboard</strong> Enter / Space toggles blind</div>
				<div class="input-item"><strong>Touch</strong> Long-press → 3× speed acceleration</div>
				<div class="input-item"><strong>Discover</strong> Animated chevrons → timed hint → auto-dismiss</div>
				<div class="input-item"><strong>Chrome</strong> F key → toggle window frame</div>
				<div class="input-item"><strong>Debug</strong> Shift+T → telemetry panel</div>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ Design Philosophy</h4>
				<ul>
					<li>One <em>passenger</em> physical metaphor — not "click here," "pull the shade"</li>
					<li>Discoverable without words — the handle animates, the chevrons cascade</li>
					<li>Satisfying to perform — maps to a real-world action everyone knows</li>
					<li>Long-press accel, keyboard, URL params, Shift+T, side panel — all real, all deliberately invisible to passengers</li>
					<li>The honest framing isn't "ONE gesture" — it's "one gesture for the cabin, everything else for the operator"</li>
					<li>Ambient, not tutorial — viewer discovers it or doesn't; either is fine</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ CONTENT -->
	<section>
		<h2>Pillar 6 — Content Pipeline</h2>
		<div class="content-split">
			<div class="content-side control">
				<h3>src/ — Control Plane</h3>
				<div class="file-tree">
					<div class="ft-item">lib/world/ — Cesium engine</div>
					<div class="ft-item">lib/camera/ — Flight + motion sim</div>
					<div class="ft-item">lib/director/ — Autopilot + scenarios</div>
					<div class="ft-item">lib/scene/ — Compositor + effects</div>
					<div class="ft-item">lib/shell/ — Pane, Blind, Glass, HUD</div>
					<div class="ft-item">lib/fleet/ — Multi-Pi networking</div>
					<div class="ft-item">lib/model/ — State, CRDT, telemetry</div>
				</div>
				<span class="split-label">Engineers</span>
			</div>
			<div class="content-divider">⟷</div>
			<div class="content-side authored">
				<h3>content/ — Authored Artifacts</h3>
				<div class="file-tree">
					<div class="ft-item">locations/ — 14 cities + natural wonders</div>
					<div class="ft-item">weather/ — 5 recipes (clear→storm)</div>
					<div class="ft-item">scenarios/ — 21 hand-crafted flight paths</div>
					<div class="ft-item">palettes/ — Sky + car-light color tables</div>
					<div class="ft-item">shows/ — Opening experience</div>
				</div>
				<span class="split-label">Curators</span>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ Rule 0 — Content/Control Split</h4>
				<ul>
					<li>Adding a location: one object in catalog.ts — LocationId union widens automatically</li>
					<li>Adding a scenario: one object in scenarios/catalog.ts — director picks it up</li>
					<li>Adding a weather type: one entry in recipes.ts + one union member — no code changes</li>
					<li>Shows are the curation primitive — opening state today, narrative arcs tomorrow</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ NIGHT -->
	<section>
		<h2>Pillar 7 — The Night Pipeline</h2>
		<p class="hidden-blurb">Simplified Phase 15.5 (2026-05-21). The CartoDB Dark imagery overlay was dropped — the post-process shader's <code>mix()</code> to navy now carries the atmospheric darkening that layer used to provide. Three imagery layers → two; five shader ops → three. Same blue-hour beat, same VIIRS terminator-awareness, fewer moving parts. See <code>docs/ADR-003-night-pipeline-simplification.md</code>.</p>
		<div class="night-stages">
			<div class="night-stage">
				<span class="stage-num">1</span>
				<div>
					<h4>Base Saturation Lerp</h4>
					<p>EOX satellite imagery saturation lerped 1.4 → 0.05 at night. Brightness lerp dropped — the shader's mix() does the darkening now. Near-greyscale prevents green hue cast at deep night.</p>
				</div>
			</div>
			<div class="night-stage">
				<span class="stage-num">2</span>
				<div>
					<h4>VIIRS Night Lights</h4>
					<p>NASA city lights smoothstep in at 0.55–0.9, capped at 50% alpha. Terminator-aware (<code>dayAlpha=0</code> / <code>nightAlpha=1</code>) so lit cities stay lit. City-by-city reveal as night deepens.</p>
				</div>
			</div>
			<div class="night-stage">
				<span class="stage-num">3</span>
				<div>
					<h4>Cesium HDR + Bloom</h4>
					<p>Built-in tonemap (contrast 128, brightness −0.3, sigma 2.2). Handles the shadow crush + contrast that the shader used to do redundantly.</p>
				</div>
			</div>
			<div class="night-stage">
				<span class="stage-num">4</span>
				<div>
					<h4>Post-Process Shader (3 ops)</h4>
					<p><strong>brightGuard</strong> protects VIIRS amber + sun disc. <strong>Base mix to navy</strong> via smoothstep(0.45, 0.9) — replaces the dropped CartoDB layer's atmospheric ramp. <strong>Pollution corona</strong> on bright pixels for the warm city halo. That's it.</p>
				</div>
			</div>
			<div class="night-stage">
				<span class="stage-num">5</span>
				<div>
					<h4>Per-Effect Visibility</h4>
					<p>Car lights appear at nightFactor > 0.2. Haze switches color palette by sky state. Each effect independently gates on night progression.</p>
				</div>
			</div>
		</div>
		<div class="pillar-detail">
			<div class="detail-box good">
				<h4>✓ The Magic</h4>
				<ul>
					<li>Smoothstep gates — linear interpolation would reveal banding; smoothstep hides the transition</li>
					<li>VIIRS floor at 0.55 prevents "magenta leak" from colorToAlpha on bright city cores at early dusk</li>
					<li>Shader gate at 0.45 — atmospheric darkening naturally precedes visible city lights by 30+ min (same beat the CartoDB layer used to provide, now inline)</li>
					<li>Viewer never sees a transition — they just notice the city lights are on</li>
				</ul>
			</div>
			<div class="detail-box good">
				<h4>↗ Queued for post-hardware-validation</h4>
				<ul>
					<li><strong>Phase 3</strong> — altitude-aware buildings emissive (Cesium3DTileColorBlendMode.HIGHLIGHT)</li>
					<li><strong>Phase 4–5</strong> — vector OSM roads as night light source (`/api/roads/:city` + pre-bake + GeoJsonDataSource + PolylineGlow)</li>
					<li><strong>Phase 6</strong> — altitude-gate VIIRS to fade below 5km so vector roads own the city-light load at low altitude</li>
					<li>Reference: "the passenger window, not the satellite" — buildings + roads as light SOURCES, not light-on-ground</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ TRADE-OFFS -->
	<section>
		<h2>Trade-offs — The Decisions Behind the Design</h2>
		<p class="hidden-blurb">Every architectural choice is a rejection of alternatives. These are the key decisions that shaped the codebase — what was chosen, what was rejected, and why.</p>
		<div class="tradeoff-table">
			<div class="tradeoff-row header">
				<span>Decision</span><span>Chosen</span><span>Rejected</span><span>Why</span>
			</div>
			<div class="tradeoff-row"><span>Timestep</span><span>Variable dt (RAF)</span><span>Fixed accumulator</span><span>Pi kiosk runs locked refresh; simplicity wins</span></div>
			<div class="tradeoff-row"><span>CRDT clock</span><span>Wall-clock Date.now()</span><span>Vector clocks / HLC</span><span>6 Pis on same LAN with NTP; drift risk accepted</span></div>
			<div class="tradeoff-row"><span>Transport</span><span>SSE + REST</span><span>WebSocket <span class="tr-note">(removed post-WS)</span></span><span>SSE is standard, debuggable, no custom framing</span></div>
			<div class="tradeoff-row"><span>State</span><span>Flat $state tree</span><span>Redux / stores</span><span>Svelte 5 runes are the reactivity primitive</span></div>
			<div class="tradeoff-row"><span>Rendering</span><span>CSS effects over WebGL</span><span>All-WebGL</span><span>CSS is lighter on Pi GPU; compositor thread is free</span></div>
			<div class="tradeoff-row"><span>Fleet</span><span>mDNS + LAN REST</span><span>Central server</span><span>Offline-first; no internet dependency</span></div>
			<div class="tradeoff-row"><span>Config sync</span><span>CRDT LWW per-path</span><span>OT / state machine</span><span>LWW is simple, path-granular, no server</span></div>
			<div class="tradeoff-row"><span>Auth</span><span>Bearer token, constant-time compare</span><span>JWT / OAuth</span><span>Pi may lack clock sync at boot; dead-simple</span></div>
			<div class="tradeoff-row"><span>Content</span><span>TypeScript union files</span><span>JSON / YAML / CMS</span><span>TypeScript narrows LocationId union automatically</span></div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ CONSTRAINTS -->
	<section>
		<h2>Constraints — The Box the Architecture Fits In</h2>
		<div class="constraint-grid">
			<div class="constraint-card">
				<h4>Hardware</h4>
				<p>Raspberry Pi 5, 8 GB RAM. Chromium kiosk mode. Single 1080p or 4K display. No dedicated GPU — WebGL runs on the VideoCore VII.</p>
			</div>
			<div class="constraint-card">
				<h4>Network</h4>
				<p>LAN-only fleet — 6 Pis on a private VLAN. No internet dependency except Cesium terrain tiles. mDNS for discovery. REST for admin. Offline-capable with pre-cached tiles.</p>
			</div>
			<div class="constraint-card">
				<h4>Deployment</h4>
				<p>Single-bundle output (SvelteKit <code>bundleStrategy: 'single'</code>). No service worker. No CDN. Kiosk boots directly into Chromium pointed at localhost:5173.</p>
			</div>
			<div class="constraint-card">
				<h4>Interaction</h4>
				<p>Touch-only kiosk — no keyboard, no mouse. Cursor hidden globally. One passenger gesture (blind drag). Admin access via LAN browser on a laptop.</p>
			</div>
			<div class="constraint-card">
				<h4>Content</h4>
				<p>Curated by non-engineers. Adding a location must not touch control-plane code. TypeScript unions widen automatically. Shows are the curation primitive.</p>
			</div>
			<div class="constraint-card">
				<h4>Reliability</h4>
				<p>Runs 24/7 on a corridor wall. Must survive power cycles, NTP desync, LAN partitions, browser crashes. Emergency reload after 10 consecutive RAF errors.</p>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ OMISSIONS -->
	<section>
		<h2>Deliberately Not Built</h2>
		<p class="hidden-blurb">What a codebase doesn't build is as architectural as what it does. These are explicit omissions — rejected with intent, not overlooked.</p>
		<div class="omission-list">
			<div class="omission-item">
				<h4>No ECS</h4>
				<p>Entity-Component-System is overkill for a single-entity product. The window IS the entity. There is no second entity to justify the pattern. What we <em>do</em> have is the Subsystem Manager Pattern (8 leaf subsystems in <code>src/lib/world/</code>) — the conceptual sibling of ECS for the single-entity case. Manager per Cesium primitive; orchestrator fans ticks.</p>
			</div>
			<div class="omission-item">
				<h4>No event queue</h4>
				<p>The RAF tick is synchronous — flight, motion, director, and rendering run in lockstep each frame. No deferred events, no message bus between systems. Simplicity over flexibility.</p>
			</div>
			<div class="omission-item">
				<h4>No server authority</h4>
				<p>State is browser-side ($state). The Bun server is a relay — it forwards REST patches to the local browser via SSE, but has no state of its own beyond the peer registry. No database. No session store.</p>
			</div>
			<div class="omission-item">
				<h4>No WebSocket</h4>
				<p>Deliberately removed in the post-WS cleanup. Replaced with SSE (server → browser) + REST (admin → device). Fewer lines, standard protocols, no custom framing, no reconnect state machine.</p>
			</div>
			<div class="omission-item">
				<h4>No WebRTC</h4>
				<p>Peer-to-peer between Pis was considered and rejected. Admin is the natural hub — a laptop on the LAN pushing config patches via REST. P2P adds NAT traversal complexity for zero gain.</p>
			</div>
			<div class="omission-item">
				<h4>No service worker</h4>
				<p>Single-bundle output makes SW caching unnecessary — there's one JS file to load. Offline tile caching is filesystem-based (PMTiles), not SW-based. Kiosk never navigates away from /.</p>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ HIDDEN PILLARS -->
	<section>
		<h2>The Hidden Pillars — Time + Networking</h2>
		<p class="hidden-intro">An earlier framing of this document named Audio as the missing pillar. An ultrathink audit (2026-05-20) showed the real missing pillars sit closer to the load-bearing centre — they're not absent, they're hiding inside other pillars, doing real work with no owner. The v1 framing is preserved at <code>docs/ARCHITECTURE-original-framing.md</code>.</p>

		<h3 class="hidden-h3">Hidden Pillar 8 — Time</h3>
		<p class="hidden-blurb">Six consumers, no owner. A <code>$state(12)</code> field plus thresholds in <code>night/index.ts</code>. Every smoothstep night gate is a function of <code>timeOfDay</code>. The triptych sync between three Pis depends on three independent <code>Date.now()</code> readings, padded by 2.5s to absorb drift. Promoting Time to its own module is the cheapest structural fix in the codebase.</p>
		<div class="audio-map">
			<div class="audio-pair">
				<span class="audio-source">Director</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">scenario + weather cycling</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">Night pipeline</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">nightFactor, skyState, dawnDuskFactor</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">Camera</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">altitude target (day vs night)</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">Sky palette</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">sodium → amber → cool → blue-white</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">Car-lights</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">visibility @ nightFactor &gt; 0.2</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">Content/Show</span>
				<span class="audio-arrow">←</span>
				<span class="audio-target">default.show.opening.timeOfDay</span>
			</div>
		</div>
		<p class="audio-note">Day 6 hardening adds the first watchdog here: <code>MIN_SANE_TIMESTAMP</code> gate on fleet connect, NTP-drift echo in heartbeat, frame-budget watchdog that auto-downgrades quality.</p>

		<h3 class="hidden-h3">Hidden Pillar 9 — Networking</h3>
		<p class="hidden-blurb">REST + SSE + CRDT + mDNS + peer-sync = <code>src/lib/fleet/</code> (12 files). The v1 framing rolls it under State's CRDT bullet — that describes the merge semantics, not the transport. Naming Networking makes field-failure modes first-class architectural concerns rather than footnotes.</p>
		<div class="detail-box good">
			<h4>✓ API security posture (v1.2)</h4>
			<ul>
				<li>18 routes, all reviewed; bearer-gated mutating endpoints fail-closed 503 when env unset</li>
				<li>Stream-counted body caps via <code>readLimitedJson</code> / <code>readLimitedBlob</code> — rejects oversized payloads mid-stream, not just by Content-Length header</li>
				<li>Auth runs BEFORE the body parser — unauthenticated callers never reach the buffer</li>
				<li>LAN-only CORS via <code>lanCorsHeaders</code>; same-origin endpoints (buildings/roads/bundle) deliberately have no CORS to keep the LAN surface small</li>
				<li>Path traversal on <code>/api/tiles/[...path]</code> defended with <code>realpathSync</code> + prefix check; hash format validated at <code>/api/bundle/[hash]</code> route boundary (defense-in-depth on top of the SSOT)</li>
				<li>Two shared helpers own the surface: <code>http/auth.ts</code> (timing-safe bearer compare) and <code>http/publish-route.ts</code> (one handler covers PATCH /api/config + POST /api/command)</li>
			</ul>
		</div>
		<div class="audio-map">
			<div class="audio-pair">
				<span class="audio-source">client.svelte.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">SSE listener + REST commands</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">rest-admin.svelte.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">admin store + peer discovery</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">peer-sync.svelte.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">$effect → POST config to every peer</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">heartbeat.server.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">60s ring buffer per device</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">parallax.svelte.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">URL / fingerprint / self role binding</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">sse-bus.server.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">in-process pub/sub</span>
			</div>
			<div class="audio-pair">
				<span class="audio-source">lan-peers.server.ts</span>
				<span class="audio-arrow">→</span>
				<span class="audio-target">mDNS announcement</span>
			</div>
		</div>
		<p class="audio-note">Field-failure modes that "State" doesn't capture: LAN partition, mDNS race, captive portal not dismissed, cold-boot Pi with un-converged NTP, peer not yet discovered. Day 6 + Day 7 hardening promotes these from footnotes to first-class concerns.</p>

		<h3 class="hidden-h3">What about Audio?</h3>
		<p class="hidden-blurb">Audio is a v2 feature, not the missing pillar. Implementation reality: zero <code>AudioContext</code> references in <code>src/</code>; the motion module's <code>engineVibeFreqX</code> (7Hz) / <code>engineVibeFreqY</code> (11Hz) are <em>state-update rates</em>, not waveforms — feeding <code>breathingPeriod</code> (a multi-second period) to a Web Audio oscillator gives sub-audible LFO, not engine drone. Pi 5 Chromium also needs <code>--autoplay-policy=no-user-gesture-required</code> in the kiosk flags. Worth doing post-ship; not architectural foundation.</p>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ VERDICT -->
	<section class="verdict-section">
		<h2>Verdict</h2>
		<div class="verdict-grid">
			<div class="verdict-stat">
				<span class="big-num">7+2</span>
				<span class="stat-label">pillars (built / hidden)</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">108</span>
				<span class="stat-label">source files</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">274</span>
				<span class="stat-label">tests passing</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">12</span>
				<span class="stat-label">locations</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">21</span>
				<span class="stat-label">flight scenarios</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">6</span>
				<span class="stat-label">Pis per fleet</span>
			</div>
		</div>
		<div class="verdict-body">
			<p><strong>Seven pillars stand.</strong> The architecture is clean — single RAF, single flat state tree, single compositor, single Z-source. The content pipeline is authorable by non-engineers. CRDT syncs 6 Pis without a central server.</p>
			<p><strong>Two more pillars are hiding in plain sight.</strong> Time has six consumers and no owner — every smoothstep night gate reads it, the triptych sync depends on it, no module owns it. Networking is buried under State's CRDT bullet, but it's 12 files of fleet code with their own failure modes — LAN partition, mDNS race, NTP drift. Naming them is the v1.1 patch this architecture needs before the SWA install lands.</p>
			<p><strong>Audio is a v2 feature, not the missing pillar.</strong> Interesting, but not load-bearing.</p>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ TERMS -->
	<section>
		<h2>Terms of Operation</h2>
		<p class="hidden-blurb">
			What the system does, what it needs, and what it owes third parties. This is the
			operational statement of terms; where a signed supply or service agreement exists for
			an install, that agreement governs and this section describes it rather than replacing
			it.
		</p>
		<div class="omission-list">
			<div class="omission-item">
				<h4>No people are recorded</h4>
				<p>
					There is no camera, no microphone, no sensor pointed at the room. The display is
					output-only. Nothing about who walks past it is measured, stored, or transmitted —
					the only inputs are the clock, the config tree, and an optional touch on the blind.
				</p>
			</div>
			<div class="omission-item">
				<h4>Telemetry stays on the LAN</h4>
				<p>
					Each device posts a heartbeat — frame rate, uptime, commit hash, recent error
					lines — to the admin surface on the local network. It contains no personal data
					and leaves the premises only if the operator opts a device into the remote push
					worker.
				</p>
			</div>
			<div class="omission-item">
				<h4>Network egress is bounded and listed</h4>
				<p>
					Map tiles, terrain and night-light imagery are packaged offline before install, so
					a fielded device runs on a dark LAN. When a tile is missing it falls back to its
					origin CDN. The full outbound list is Cesium Ion, EOX Sentinel-2, NASA GIBS,
					OpenStreetMap, and — only when configured — the operator's own Cloudflare Worker.
				</p>
			</div>
			<div class="omission-item">
				<h4>Third-party data carries attribution</h4>
				<p>
					Terrain and imagery are licensed, not owned. Cesium Ion terrain is used under
					Cesium's terms; Sentinel-2 Cloudless is © EOX IT Services under CC BY-NC-SA;
					VIIRS night-lights radiance is NASA public-domain; road and building geometry is ©
					OpenStreetMap contributors under ODbL. Attribution travels with any install or
					screenshot that shows them.
				</p>
			</div>
			<div class="omission-item">
				<h4>Admin actions are token-gated</h4>
				<p>
					Every mutating endpoint — config patch, command fan-out, content upload, update
					trigger, WiFi reset — requires a bearer token and returns 503 when its token is
					unset, so an unconfigured device fails closed rather than open. Holding the token
					means holding control of the wall; it is the operator's to protect.
				</p>
			</div>
			<div class="omission-item">
				<h4>Not a safety or information system</h4>
				<p>
					The view is composed, not reported. Sun position and moon phase are real; weather,
					location, altitude and traffic are authored fiction on a rotation. Nothing on the
					screen should be read as a forecast, a flight, or a status board.
				</p>
			</div>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════════════ LIFECYCLE -->
	<section>
		<h2>Product Lifecycle — 6 Months</h2>
		<p class="hidden-blurb">
			The supported lifecycle for an install is <strong>six months from handover</strong>,
			covering the whole product — the Raspberry Pi 5 units and displays, the software on
			them, and the authored content they play. The date is set per install and recorded with
			the handover, not derived from this page.
		</p>
		<div class="verdict-stats">
			<div class="verdict-stat">
				<span class="big-num">6</span>
				<span class="stat-label">months supported</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">15</span>
				<span class="stat-label">min update poll</span>
			</div>
			<div class="verdict-stat">
				<span class="big-num">0</span>
				<span class="stat-label">cloud services required</span>
			</div>
		</div>
		<div class="omission-list">
			<div class="omission-item">
				<h4>During the term</h4>
				<p>
					Fixes and content ship over the air: CI gates every commit behind type-check,
					tests and a boot smoke test, then advances the <code>release</code> branch, which
					each device polls every 15 minutes and installs with automatic rollback on a bad
					build. Hardware faults in the supplied units are covered, and the admin surface
					stays supported for operator changes.
				</p>
			</div>
			<div class="omission-item">
				<h4>At end of life</h4>
				<p>
					The wall does not go dark. Updates simply stop being published — the device keeps
					running the last release it installed, with its packaged tiles, on the local
					network, indefinitely and without any service to phone home to. What ends is new
					work, not the display.
				</p>
			</div>
			<div class="omission-item">
				<h4>What is not covered</h4>
				<p>
					Operating-system and firmware patching on the fielded devices, network and power
					at the site, physical damage, and any content or location added after handover
					are the operator's, unless a maintenance term says otherwise.
				</p>
			</div>
			<div class="omission-item">
				<h4>Continuing past six months</h4>
				<p>
					Extension is a renewal, not a default — a further support term, or handover of
					the repository and provisioning scripts so the operator runs the pipeline itself.
					Both paths are deliberate: nothing in the device requires our infrastructure to
					keep working.
				</p>
			</div>
		</div>
	</section>

	<footer class="arch-footer">
		<p>Aero Dynamic Window · SvelteKit 2 + Cesium + Bun · Raspberry Pi 5 Kiosk · SWA Hyderabad install · 2026</p>
		<p class="arch-footer-sub">v1.2 (2026-07-28). Subsystem Manager Pattern now formalised across <code>src/lib/world/</code> (8 leaf managers + orchestrator). Original v1 framing preserved at <code>docs/ARCHITECTURE-original-framing.md</code>. Z-order values sourced from <code>src/lib/scene/layers.ts</code>; sky-state thresholds from <code>src/lib/utils.ts</code>; subsystem pattern documented at <code>AGENTS.md</code>.</p>
	</footer>
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #0a0a14;
		color: #e0e0e8;
		font-family: "Ubuntu", system-ui, -apple-system, sans-serif;
		line-height: 1.6;
	}

	.arch-doc {
		max-width: 960px;
		margin: 0 auto;
		padding: 40px 24px 80px;
	}

	/* ── Hero ──────────────────────────────────────────────────────── */

	.hero {
		text-align: center;
		padding: 60px 0 40px;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		margin-bottom: 48px;
	}

	.hero h1 {
		font-size: 48px;
		font-weight: 700;
		margin: 0 0 8px;
		background: linear-gradient(135deg, #304cb2 0%, #ffbf27 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		font-size: 20px;
		font-weight: 300;
		color: #8890b0;
		margin: 0 0 16px;
	}

	.deck {
		font-size: 15px;
		color: #667090;
		max-width: 560px;
		margin: 0 auto 24px;
	}

	.hero-meta {
		display: flex;
		gap: 12px;
		justify-content: center;
		flex-wrap: wrap;
	}

	.hero-meta span {
		background: rgba(48,76,178,0.15);
		border: 1px solid rgba(48,76,178,0.25);
		color: #8898cc;
		padding: 4px 14px;
		border-radius: 20px;
		font-size: 13px;
	}

	/* ── Sections ──────────────────────────────────────────────────── */

	section {
		margin-bottom: 64px;
	}

	h2 {
		font-size: 28px;
		font-weight: 600;
		margin: 0 0 28px;
		color: #c8d0e8;
		letter-spacing: -0.3px;
	}

	h3 {
		font-size: 18px;
		font-weight: 600;
		margin: 0 0 6px;
		color: #b0b8d8;
	}

	h4 {
		font-size: 14px;
		font-weight: 600;
		margin: 0 0 6px;
		color: #99a0c0;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	/* ── Engine Architecture Stack ─────────────────────────────────── */

	.arch-stack {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 24px;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(255,255,255,0.06);
	}

	.arch-layer {
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		font-size: 14px;
		font-weight: 600;
		color: #b0c0e8;
	}

	.arch-layer.title {
		background: rgba(255,255,255,0.03);
		color: #c8d0e8;
		font-size: 16px;
	}

	.arch-layer.svelte {
		background: rgba(48,76,178,0.18);
		border-left: 3px solid #6080cc;
	}

	.arch-layer.cesium {
		background: rgba(255,191,39,0.10);
		border-left: 3px solid #ffbf27;
	}

	.arch-layer.data {
		background: rgba(192,132,252,0.10);
		border-left: 3px solid #c084fc;
	}

	.arch-layer.gpu {
		background: rgba(213,21,46,0.08);
		border-left: 3px solid #d5152e;
	}

	.arch-sub {
		font-size: 11px;
		font-weight: 400;
		color: #6678a0;
		margin-top: 2px;
		font-family: "JetBrains Mono", monospace;
	}

	.ownership-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin-bottom: 24px;
	}

	.ownership-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 10px;
		padding: 14px 16px;
	}

	.ownership-card h4 {
		margin-bottom: 4px;
	}

	.ownership-card p {
		font-size: 12px;
		color: #7780a0;
		margin: 0;
		line-height: 1.5;
	}

	.arch-footer-line {
		font-size: 13px;
		color: #667090;
		margin-top: 16px;
	}

	.arch-footer-line code {
		font-family: "JetBrains Mono", monospace;
		font-size: 12px;
		color: #8098cc;
	}

	/* ── Pillar Grid ───────────────────────────────────────────────── */

	.pillar-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
	}

	.pillar-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px;
		padding: 20px;
		position: relative;
	}

	.pillar-card.built { border-left: 3px solid #304cb2; }
	.pillar-card.hidden { border-left: 3px solid #c084fc; background: rgba(192, 132, 252, 0.04); }
	.pillar-card.hidden .badge { background: rgba(192, 132, 252, 0.15); color: #c084fc; }
	.pillar-card.hidden .pillar-num { color: #a078d8; }

	.hidden-intro {
		font-size: 14px;
		color: #8890b0;
		max-width: 720px;
		margin: 0 0 32px;
		padding: 16px 20px;
		border-left: 3px solid #c084fc;
		background: rgba(192, 132, 252, 0.04);
		border-radius: 0 6px 6px 0;
	}
	.hidden-h3 {
		font-size: 18px;
		font-weight: 600;
		color: #e0e0e8;
		margin: 40px 0 8px;
	}
	.hidden-blurb {
		font-size: 14px;
		color: #a8b0c8;
		margin: 0 0 16px;
		max-width: 760px;
	}

	.pillar-num {
		font-size: 13px;
		font-weight: 700;
		color: #5568a0;
		display: block;
		margin-bottom: 6px;
	}

	.pillar-card h3 { font-size: 16px; margin: 0 0 4px; }
	.pillar-card p { font-size: 13px; color: #7780a0; margin: 0; }

	.badge {
		position: absolute;
		top: 20px;
		right: 20px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		padding: 2px 8px;
		border-radius: 10px;
	}

	.built .badge { background: rgba(48,76,178,0.2); color: #6080cc; }

	/* ── Flow Diagram ──────────────────────────────────────────────── */

	.flow-diagram {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		margin-bottom: 24px;
	}

	.flow-node {
		background: rgba(48,76,178,0.12);
		border: 1px solid rgba(48,76,178,0.3);
		border-radius: 10px;
		padding: 12px 24px;
		text-align: center;
		font-weight: 600;
		font-size: 14px;
		color: #b0c0e8;
	}

	.flow-node.root {
		background: rgba(48,76,178,0.2);
		border-color: rgba(48,76,178,0.5);
	}

	.flow-sub {
		font-size: 11px;
		font-weight: 400;
		color: #6678a0;
		margin-top: 2px;
	}

	.flow-arrow {
		font-size: 13px;
		color: #5568a0;
		padding: 4px 0;
	}

	.flow-row {
		display: flex;
		gap: 12px;
		align-items: center;
	}

	.flow-row .flow-node { flex: 1; }
	.flow-plus { color: #5568a0; font-weight: 700; font-size: 18px; }

	/* ── State Diagram ─────────────────────────────────────────────── */

	.state-diagram {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		margin-bottom: 24px;
	}

	.state-box {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px;
		padding: 14px 20px;
		text-align: center;
	}

	.state-box.root-state {
		background: rgba(48,76,178,0.1);
		border-color: rgba(48,76,178,0.3);
	}

	.state-box.small {
		padding: 8px 16px;
		font-size: 12px;
	}

	.state-label {
		font-weight: 600;
		font-size: 14px;
		color: #b0c0e8;
		margin-bottom: 8px;
	}

	.state-namespaces {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.state-namespaces span {
		background: rgba(48,76,178,0.15);
		border-radius: 6px;
		padding: 3px 10px;
		font-size: 12px;
		color: #8098cc;
		font-family: "JetBrains Mono", monospace;
	}

	.state-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}

	/* ── Z-Stack ───────────────────────────────────────────────────── */

	.z-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 24px;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(255,255,255,0.06);
	}

	.z-layer {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: rgba(255,255,255, calc(var(--alpha)));
		border-bottom: 1px solid rgba(255,255,255,0.04);
		font-size: 13px;
		position: relative;
	}

	.z-layer::before {
		content: '';
		position: absolute;
		left: 0; top: 0; bottom: 0;
		width: calc(var(--z) * 1.5px + 2px);
		background: linear-gradient(180deg, rgba(48,76,178,0.6), rgba(48,76,178,0.1));
	}

	.z-layer:last-child { border-bottom: none; }

	.z-num {
		font-family: "JetBrains Mono", monospace;
		font-size: 11px;
		font-weight: 700;
		color: #5568a0;
		min-width: 36px;
		padding-left: calc(var(--z) * 1.5px + 8px);
	}

	.z-name {
		font-weight: 600;
		min-width: 120px;
		color: #b0b8d0;
	}

	.z-desc {
		color: #667090;
		font-size: 12px;
		flex: 1;
	}

	.z-layer.cesium { background: rgba(48,76,178,0.18); }
	.z-layer.wing { background: rgba(255,255,255,0.04); }
	.z-layer.frost { background: rgba(200,220,255,0.06); }
	.z-layer.micro { background: rgba(255,191,39,0.04); }
	.z-layer.storm { background: rgba(213,21,46,0.05); }
	.z-layer.clouds { background: rgba(255,255,255,0.05); }

	/* ── Camera Compare ────────────────────────────────────────────── */

	.camera-compare {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 20px;
		align-items: start;
		margin-bottom: 28px;
	}

	.camera-mode {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px;
		padding: 20px;
	}

	.camera-mode h3 {
		font-size: 16px;
		text-align: center;
		margin-bottom: 16px;
	}

	.camera-viz {
		width: 100%;
		height: 100px;
		position: relative;
		margin-bottom: 16px;
		border-radius: 8px;
		overflow: hidden;
	}

	.orbit-viz {
		background: radial-gradient(ellipse at center, rgba(48,76,178,0.15) 0%, transparent 70%);
	}

	.orbit-ring {
		position: absolute;
		inset: 15%;
		border: 1px dashed rgba(48,76,178,0.3);
		border-radius: 50%;
		animation: orbit-spin 8s linear infinite;
	}

	.orbit-dot {
		position: absolute;
		width: 6px; height: 6px;
		background: #6080cc;
		border-radius: 50%;
		top: 30%; left: 55%;
		animation: orbit-spin 8s linear infinite;
	}

	@keyframes orbit-spin { to { transform: rotate(360deg); } }

	.cruise-viz {
		background: linear-gradient(90deg, transparent 0%, rgba(48,76,178,0.1) 50%, rgba(255,191,39,0.1) 100%);
	}

	.cruise-trail {
		position: absolute;
		top: 50%; left: 20%; right: 20%;
		height: 2px;
		background: linear-gradient(90deg, transparent, #ffbf27, transparent);
	}

	.cruise-dot {
		position: absolute;
		width: 8px; height: 8px;
		background: #ffbf27;
		border-radius: 50%;
		top: calc(50% - 4px);
		animation: cruise-move 2s ease-in-out infinite alternate;
	}

	@keyframes cruise-move {
		0% { left: 20%; transform: scale(1); opacity: 0.4; }
		50% { transform: scale(2); opacity: 1; }
		100% { left: calc(80% - 8px); transform: scale(1); opacity: 0.4; }
	}

	.camera-mode ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.camera-mode li {
		font-size: 12px;
		color: #8890b0;
		padding: 3px 0;
		padding-left: 14px;
		position: relative;
	}

	.camera-mode li::before {
		content: '·';
		position: absolute;
		left: 4px;
		color: #5568a0;
	}

	.camera-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		color: #667090;
		padding-top: 60px;
		white-space: nowrap;
	}

	/* ── Motion Grid ───────────────────────────────────────────────── */

	.motion-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 12px;
	}

	.motion-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.05);
		border-radius: 10px;
		padding: 14px;
		text-align: center;
	}

	.motion-card h4 { margin-bottom: 4px; }
	.motion-card p { font-size: 12px; color: #7780a0; margin: 0; line-height: 1.5; }

	/* ── Input Focus ───────────────────────────────────────────────── */

	.input-hero {
		text-align: center;
		padding: 32px;
		background: rgba(48,76,178,0.08);
		border: 1px solid rgba(48,76,178,0.2);
		border-radius: 16px;
		margin-bottom: 20px;
	}

	.gesture-icon { font-size: 40px; display: block; margin-bottom: 8px; }
	.big-gesture { font-size: 18px; font-weight: 500; color: #c0d0f0; margin: 0; }

	.input-details {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 8px;
	}

	.input-item {
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.04);
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		color: #8890b0;
	}

	.input-item strong { color: #b0b8d0; }

	/* ── Content Split ─────────────────────────────────────────────── */

	.content-split {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 16px;
		align-items: start;
		margin-bottom: 24px;
	}

	.content-side {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px;
		padding: 20px;
		text-align: center;
	}

	.content-side h3 { margin-bottom: 14px; }

	.file-tree { text-align: left; }

	.ft-item {
		font-size: 12px;
		font-family: "JetBrains Mono", monospace;
		color: #8890b0;
		padding: 3px 0;
	}

	.content-divider {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		color: #5568a0;
		padding-top: 40px;
	}

	.split-label {
		display: inline-block;
		margin-top: 14px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		color: #5568a0;
		padding: 3px 10px;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px;
	}

	/* ── Night Stages ──────────────────────────────────────────────── */

	.night-stages {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin-bottom: 24px;
	}

	.night-stage {
		display: flex;
		gap: 16px;
		padding: 14px 0;
		border-bottom: 1px solid rgba(255,255,255,0.04);
		align-items: flex-start;
	}

	.stage-num {
		width: 28px; height: 28px;
		background: rgba(48,76,178,0.2);
		border: 1px solid rgba(48,76,178,0.4);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 13px;
		font-weight: 700;
		color: #6080cc;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.night-stage h4 { font-size: 14px; margin: 0 0 2px; }
	.night-stage p { font-size: 13px; color: #7780a0; margin: 0; }

	/* ── Audio Map ─────────────────────────────────────────────────── */

	.audio-map {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 20px;
	}

	.audio-pair {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 8px 14px;
		background: rgba(255,191,39,0.04);
		border: 1px solid rgba(255,191,39,0.1);
		border-radius: 8px;
	}

	.audio-source {
		font-family: "JetBrains Mono", monospace;
		font-size: 12px;
		color: #8898cc;
		min-width: 180px;
	}

	.audio-arrow {
		color: #ffbf27;
		font-weight: 700;
	}

	.audio-target {
		font-size: 13px;
		color: #b0b8d0;
	}

	.hidden-intro {
		font-size: 14px;
		color: #8890b0;
		max-width: 720px;
		margin: 0 0 32px;
		padding: 16px 20px;
		border-left: 3px solid #c084fc;
		background: rgba(192, 132, 252, 0.04);
		border-radius: 0 6px 6px 0;
	}
	.hidden-h3 {
		font-size: 18px;
		font-weight: 600;
		color: #e0e0e8;
		margin: 40px 0 8px;
	}
	.hidden-blurb {
		font-size: 14px;
		color: #a8b0c8;
		margin: 0 0 16px;
		max-width: 760px;
	}

	.audio-note {
		font-size: 13px;
		color: #667090;
		font-style: italic;
	}

	/* Inline code */
	:global(code) {
		font-family: "JetBrains Mono", monospace;
		font-size: 12px;
		background: rgba(255,255,255,0.06);
		padding: 1px 6px;
		border-radius: 4px;
		color: #a0b0d0;
	}

	:global(em) {
		color: #c0c8e0;
		font-style: italic;
	}

	/* ── Detail Boxes ──────────────────────────────────────────────── */

	.pillar-detail {
		margin-top: 16px;
	}

	.detail-box {
		border-radius: 10px;
		padding: 16px 20px;
		margin-bottom: 10px;
	}

	.detail-box.good {
		background: rgba(48,76,178,0.06);
		border: 1px solid rgba(48,76,178,0.15);
	}

	.detail-box.note {
		background: rgba(255,191,39,0.04);
		border: 1px solid rgba(255,191,39,0.1);
	}

	.detail-box ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.detail-box li {
		font-size: 13px;
		color: #8890b0;
		padding: 2px 0;
		padding-left: 14px;
		position: relative;
	}

	.detail-box li::before {
		content: '·';
		position: absolute;
		left: 4px;
		color: #5568a0;
	}

	/* ── Verdict ───────────────────────────────────────────────────── */

	.verdict-section {
		border-top: 1px solid rgba(255,255,255,0.08);
		padding-top: 48px;
	}

	.verdict-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		margin-bottom: 28px;
	}

	.verdict-stat {
		text-align: center;
		padding: 20px;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px;
	}

	.big-num {
		font-size: 36px;
		font-weight: 700;
		display: block;
		background: linear-gradient(135deg, #6080cc, #c0d0f0);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.stat-label {
		font-size: 12px;
		color: #667090;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.verdict-body p {
		font-size: 14px;
		color: #8890b0;
		margin: 0 0 10px;
	}

	.verdict-body strong { color: #b0b8d0; }

	/* ── Footer ────────────────────────────────────────────────────── */

	.arch-footer {
		text-align: center;
		padding-top: 40px;
		border-top: 1px solid rgba(255,255,255,0.05);
	}

	.arch-footer p {
		font-size: 12px;
		color: #556080;
		margin: 0 0 4px;
	}
	.arch-footer-sub {
		font-size: 11px !important;
		color: #404868 !important;
	}

	/* ── Trade-off Table ───────────────────────────────────────────── */

	.tradeoff-table {
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 8px;
	}

	.tradeoff-row {
		display: grid;
		grid-template-columns: 100px 1fr 1fr 1.6fr;
		gap: 8px;
		padding: 10px 14px;
		font-size: 12px;
		color: #8890b0;
		border-bottom: 1px solid rgba(255,255,255,0.03);
		align-items: center;
	}

	.tradeoff-row:last-child { border-bottom: none; }

	.tradeoff-row.header {
		background: rgba(48,76,178,0.1);
		font-weight: 700;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #6080cc;
	}

	.tradeoff-row span:first-child {
		font-weight: 600;
		color: #b0b8d0;
	}

	.tr-note {
		font-size: 10px;
		color: #667090;
		font-style: italic;
	}

	/* ── Constraint Grid ──────────────────────────────────────────── */

	.constraint-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}

	.constraint-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 10px;
		padding: 16px;
	}

	.constraint-card h4 {
		margin-bottom: 6px;
	}

	.constraint-card p {
		font-size: 13px;
		color: #7780a0;
		margin: 0;
		line-height: 1.5;
	}

	/* ── Omission List ────────────────────────────────────────────── */

	.omission-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}

	.omission-item {
		background: rgba(213,21,46,0.03);
		border: 1px solid rgba(213,21,46,0.08);
		border-left: 3px solid rgba(213,21,46,0.2);
		border-radius: 0 8px 8px 0;
		padding: 14px;
	}

	.omission-item h4 {
		font-size: 13px;
		color: #d07080;
		margin-bottom: 4px;
	}

	.omission-item p {
		font-size: 12px;
		color: #8890b0;
		margin: 0;
		line-height: 1.5;
	}

	/* ── Responsive ────────────────────────────────────────────────── */

	@media (max-width: 720px) {
		.hero h1 { font-size: 32px; }
		.camera-compare { grid-template-columns: 1fr; }
		.camera-arrow { padding-top: 0; transform: rotate(90deg); }
		.content-split { grid-template-columns: 1fr; }
		.content-divider { transform: rotate(90deg); padding-top: 0; }
		.verdict-grid { grid-template-columns: repeat(2, 1fr); }
		.z-name { min-width: 80px; }
		.z-desc { display: none; }
	}
</style>

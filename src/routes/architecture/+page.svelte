<script lang="ts">
	let expandedLayer = $state<string | null>(null);

	function toggleLayer(id: string) {
		expandedLayer = expandedLayer === id ? null : id;
	}

	interface Layer {
		id: string;
		name: string;
		z: string;
		condition: string;
		description: string;
		category: 'glass' | 'css' | 'gpu' | 'imagery';
		details: string[];
		previewType: 'css' | 'shader' | 'imagery' | 'cloud';
	}

	const layers: Layer[] = [
		{
			id: 'glass-frame',
			name: 'Glass Frame',
			z: 'z:11',
			condition: 'always',
			description: 'Glass recess rim — box-shadow inset depth illusion',
			category: 'glass',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .glass-recess',
				'Effect: inset box-shadow (10px 4px spread)',
				'Purpose: Creates the 3D depth where glass meets the metallic rim',
			],
		},
		{
			id: 'vignette',
			name: 'Vignette',
			z: 'z:10',
			condition: 'always',
			description: 'Elliptical edge darkening — 75% × 65% radial gradient',
			category: 'css',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .vignette',
				'Effect: radial-gradient, transparent center → rgba(0,0,0,0.3) edge',
				'Purpose: Directs eye to center, simulates lens curvature',
			],
		},
		{
			id: 'glass-surface',
			name: 'Glass Surface',
			z: 'z:9',
			condition: 'always',
			description: 'Radial vignette, opacity varies by skyState',
			category: 'glass',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .glass-vignette',
				'Opacity: night=0.3, day=0.1, dawn/dusk=0.2',
				'Effect: radial-gradient from transparent (50%) to rgba(0,0,0,0.6)',
				'Sync: glassVignetteOpacity $derived from model.skyState',
			],
		},
		{
			id: 'wing',
			name: 'Wing Silhouette',
			z: 'z:7',
			condition: 'always',
			description: 'Linear gradient silhouette, rotates with bankAngle',
			category: 'css',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .wing-silhouette',
				'Position: bottom:-5%, left:-15%, 75% × 35%',
				'Transform: rotate(-2 + bankAngle × 0.3) degrees',
				'Gradient: 25deg from rgba(20,20,25,0.7) to transparent at 60%',
			],
		},
		{
			id: 'frost',
			name: 'Frost',
			z: 'z:5',
			condition: 'altitude > 25,000 ft',
			description: 'Radial edge frost with 8s breathing animation',
			category: 'css',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .frost-layer',
				'Threshold: FROST_START_ALTITUDE=25000, FROST_MAX_ALTITUDE=40000',
				'Opacity: (altitude - 25000) / 15000 × 0.3',
				'Animation: frost-breathe 8s ease-in-out infinite alternate',
				'Constants: AIRCRAFT.FROST_START_ALTITUDE, AIRCRAFT.FROST_MAX_ALTITUDE',
			],
		},
		{
			id: 'micro-events',
			name: 'Micro-Events',
			z: 'z:3',
			condition: '20–40 min intervals',
			description: 'Shooting star (night) · Bird (day 40%) · Contrail (day 60%)',
			category: 'css',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .micro-event-*',
				'Timing: MIN_INTERVAL=1200s, MAX_INTERVAL=2400s, INITIAL_DELAY=300s',
				'Shooting star: 1.5s duration, night only, diagonal streak',
				'Bird: 8s duration, day only (40% chance), flapping wings',
				'Contrail: 12s duration, day only (60% chance), expanding white line',
				'Tick: tickMicroEvents(delta) in WindowModel',
			],
		},
		{
			id: 'weather',
			name: 'Weather',
			z: 'z:2',
			condition: 'weather dependent',
			description: 'Rain (2 parallax layers) · Lightning (radial flash)',
			category: 'css',
			previewType: 'css',
			details: [
				'Rendered by: Window.svelte .rain-layer, .lightning-flash',
				'Rain: near (0.4s cycle, 80px) + far (0.6s, 50px, 50% opacity)',
				'Wind angle: clear=88°, cloudy=87°, rain=86°, storm=84°',
				'Lightning: radial-gradient at (lightningX%, lightningY%)',
				'Lightning timing: 5–30s interval, decay rate 8',
				'Tick: tickLightning(delta) in WindowModel',
			],
		},
		{
			id: 'clouds',
			name: 'Clouds',
			z: 'z:1',
			condition: 'cloudOpacity > 0',
			description: 'Three.js WebGL — texture-based FBM with camera parallax (3 depth layers)',
			category: 'gpu',
			previewType: 'cloud',
			details: [
				'Rendered by: CloudCanvas.svelte → Three.js ShaderMaterial (cloud-shader.ts)',
				'Textures: cloud-noise.png (512² RGBA: Perlin-Worley/Worley/Worley-hi/Perlin-lo), cloud-detail.png (256² RGBA: Worley-F2/Curl-X/Curl-Y/hi-freq-Perlin)',
				'Layers: far (parallax=0.05, scale=1.5) · mid (parallax=0.2, scale=3.0) · near (parallax=0.5, scale=5.0)',
				'Camera parallax: heading shifts UV.x, pitch shifts UV.y — per-layer depth rates',
				'Altitude masking: above 30k ft (deck below), 15–25k ft (whiteout), below 15k ft (deck above)',
				'Half-res rendering: devicePixelRatio × 0.5 (saves 4× fill rate)',
				'Lighting: Beer-Lambert self-shadowing, silver-lining edge glow',
				'Fallback: computed 3-octave FBM noise when textures fail to load',
				'Output: premultiplied alpha for transparent compositing over Cesium',
			],
		},
		{
			id: 'bloom',
			name: 'Post: Bloom',
			z: 'GPU',
			condition: 'nightFactor > 0.7',
			description: 'Cesium built-in bloom — soft glow on city lights',
			category: 'gpu',
			previewType: 'shader',
			details: [
				'Rendered by: CesiumViewer.svelte → viewer.scene.postProcessStages.bloom',
				'Contrast: 135, Brightness: 0.04',
				'Sigma: 7.0, Delta: 1.0, StepSize: 2.0',
				'Enable: nightFactor > 0.7 (full night only)',
				'Constants: CESIUM.BLOOM_*',
			],
		},
		{
			id: 'color-grading',
			name: 'Post: Color Grading',
			z: 'GPU',
			condition: 'always (scaled by nf)',
			description: 'lightMask → desaturate → sodium palette → dark void → haze → dawn rim light',
			category: 'gpu',
			previewType: 'shader',
			details: [
				'Rendered by: CesiumViewer.svelte → PostProcessStage',
				'Shader: cesium-shaders.ts COLOR_GRADING_GLSL',
				'Uniforms: u_nightFactor, u_dawnDuskFactor, u_lightIntensity',
				'Pipeline: luminance → lightMask (smoothstep 0.12→0.5) → desaturate ×0.8',
				'  → sodium/amber/white palette → additive blend ×2.5',
				'  → dark void crush (smoothstep 0.05→0.2, ×0.7)',
				'  → light pollution haze → shadow crush → contrast ×1.3',
				'  → horizon atmospheric haze (band at y=0.35)',
				'  → dawn/dusk directional rim light (left edge warm gold)',
			],
		},
		{
			id: 'fxaa',
			name: 'Post: FXAA',
			z: 'GPU',
			condition: 'always',
			description: 'Anti-aliasing post-process',
			category: 'gpu',
			previewType: 'shader',
			details: [
				'Rendered by: CesiumViewer.svelte → viewer.scene.postProcessStages.fxaa',
				'Enabled: always (set during viewer creation)',
			],
		},
		{
			id: 'viirs',
			name: 'VIIRS City Lights',
			z: 'img:2',
			condition: 'nightFactor > 0',
			description: 'NASA 2012 · max zoom 8 (~750m) · colorToAlpha(black)',
			category: 'imagery',
			previewType: 'imagery',
			details: [
				'Provider: WebMapTileServiceImageryProvider (WMTS)',
				'Source: NASA GIBS — VIIRS_CityLights_2012',
				'Format: JPEG, max level 8',
				'Alpha: nightFactor × 0.45',
				'Brightness: lerp(1.0, 2.0, nf) × nightLightScale',
				'Contrast: 1.8, Saturation: 0.0 (grayscale)',
				'colorToAlpha: black, threshold 0.15 (dark pixels → transparent)',
				'Credit: NASA Earth Observatory',
			],
		},
		{
			id: 'roads',
			name: 'CartoDB Dark Roads',
			z: 'img:1',
			condition: 'nightFactor > 0.01',
			description: 'OSM roads @2x · max zoom 18 · colorToAlpha(black)',
			category: 'imagery',
			previewType: 'imagery',
			details: [
				'Provider: UrlTemplateImageryProvider',
				'Source: basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
				'Max level: 18 (street-level detail)',
				'Alpha: nightFactor × 0.5',
				'Brightness: lerp(1.0, 2.5, nf) × nightLightScale',
				'Contrast: 1.6, Saturation: 0.0',
				'colorToAlpha: black, threshold 0.15',
				'Credit: OpenStreetMap contributors, CARTO',
			],
		},
		{
			id: 'esri',
			name: 'ESRI World Imagery',
			z: 'img:0',
			condition: 'always (FULL BRIGHTNESS)',
			description: 'Satellite terrain · terrainDarkness=0 · the foundation',
			category: 'imagery',
			previewType: 'imagery',
			details: [
				'Provider: ArcGisMapServerImageryProvider',
				'Source: services.arcgisonline.com World_Imagery MapServer',
				'Fallback: OpenStreetMap tiles if ESRI fails',
				'terrainDarkness: 0 — terrain stays bright even at night',
				'Brightness: lerp(1.0, max(0.08, 1.0 - darkness×1.4), nf)',
				'Saturation: lerp(1.0, 0.0, nf) — full grayscale at night',
				'Contrast: lerp(1.0, max(0.6, 1.0 - darkness×0.3), nf)',
				'Key insight: full-brightness grayscale terrain → color grading shader → warm city glow',
			],
		},
	];

	const categoryColors: Record<string, string> = {
		glass: '#cccccc',
		css: '#d5152e',
		gpu: '#ffbf27',
		imagery: '#304cb2',
	};

	const categoryLabels: Record<string, string> = {
		glass: 'Glass / Frame',
		css: 'CSS Overlay',
		gpu: 'GPU Post-Process',
		imagery: 'Cesium Imagery',
	};

	interface DataSource {
		name: string;
		format: string;
		maxZoom: string;
		cost: string;
		role: string;
		status: 'active' | 'disabled' | 'optional';
	}

	const dataSources: DataSource[] = [
		{ name: 'ESRI World Imagery', format: 'ArcGIS REST', maxZoom: '~19', cost: 'Free', role: 'Base satellite terrain', status: 'active' },
		{ name: 'Cesium World Terrain', format: 'Ion (quantized-mesh)', maxZoom: '~15', cost: 'Free (Ion token)', role: '3D terrain elevation', status: 'active' },
		{ name: 'NASA VIIRS 2012', format: 'WMTS (JPEG)', maxZoom: '8', cost: 'Free', role: 'City light overlay (night)', status: 'active' },
		{ name: 'CartoDB Dark (no labels)', format: 'XYZ tiles (PNG @2x)', maxZoom: '18', cost: 'Free', role: 'OSM road glow (night)', status: 'active' },
		{ name: 'Ion OSM Buildings', format: '3D Tiles (asset 96188)', maxZoom: '—', cost: 'Free (Ion token)', role: '3D extruded buildings', status: 'disabled' },
		{ name: 'Google 3D Tiles', format: 'Photorealistic 3D Tiles', maxZoom: '—', cost: 'Paid API key', role: 'Photorealistic buildings', status: 'optional' },
	];

	const statusColors: Record<string, string> = {
		active: '#4ade80',
		disabled: '#666',
		optional: '#facc15',
	};

	interface DirectorSegment {
		label: string;
		start: number;
		end: number;
		color: string;
		preference: string;
	}

	const directorSegments: DirectorSegment[] = [
		{ label: 'Night', start: 0, end: 5, color: '#1a1a3a', preference: 'Cities (light islands)' },
		{ label: 'Dawn', start: 5, end: 7, color: '#c07050', preference: 'Nature (golden light)' },
		{ label: 'Morning', start: 7, end: 10, color: '#6a9ad0', preference: 'Nature (fresh light)' },
		{ label: 'Midday', start: 10, end: 14, color: '#8cb8e0', preference: 'Cities (sharp detail)' },
		{ label: 'Afternoon', start: 14, end: 16, color: '#7aade0', preference: 'Cities (warm tone)' },
		{ label: 'Golden Hour', start: 16, end: 18, color: '#e0a070', preference: 'Nature (golden)' },
		{ label: 'Dusk', start: 18, end: 20, color: '#503050', preference: 'Nature → Cities' },
		{ label: 'Night', start: 20, end: 24, color: '#1a1a3a', preference: 'Cities (light islands)' },
	];
</script>

<svelte:head>
	<title>Architecture — Sky Portal</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="page">
	<nav class="top-nav">
		<a href="/" class="back-link">← Back to Sky Portal</a>
	</nav>

	<header class="hero">
		<h1>Rendering Architecture</h1>
		<p class="subtitle">Every layer, data source, and composition step in the Aero Window pipeline</p>
	</header>

	<!-- ================================================================ -->
	<!-- SECTION 1: VISUAL LAYER STACK -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>Visual Layer Stack</h2>
		<p class="section-desc">The window composites Cesium terrain with CSS overlays. Click any layer to expand details.</p>

		<div class="legend">
			{#each Object.entries(categoryLabels) as [key, label]}
				<span class="legend-item">
					<span class="legend-dot" style:background={categoryColors[key]}></span>
					{label}
				</span>
			{/each}
		</div>

		<div class="layer-stack">
			{#each layers as layer}
				<button
					class="layer-bar"
					class:expanded={expandedLayer === layer.id}
					onclick={() => toggleLayer(layer.id)}
					type="button"
				>
					<div class="layer-accent" style:background={categoryColors[layer.category]}></div>
					<div class="layer-content">
						<div class="layer-header">
							<span class="layer-name">{layer.name}</span>
							<span class="layer-z">{layer.z}</span>
							<span class="layer-condition">{layer.condition}</span>
						</div>
						<p class="layer-desc">{layer.description}</p>
						{#if expandedLayer === layer.id}
							<div class="layer-details">
								{#each layer.details as detail}
									<div class="detail-line">{detail}</div>
								{/each}
								<!-- Live preview -->
								<div class="layer-preview">
									{#if layer.id === 'glass-frame'}
										<div class="preview-glass-frame"><div class="preview-inner"></div></div>
									{:else if layer.id === 'vignette'}
										<div class="preview-vignette"></div>
									{:else if layer.id === 'glass-surface'}
										<div class="preview-glass-surface"></div>
									{:else if layer.id === 'wing'}
										<div class="preview-wing"><div class="preview-wing-shape"></div></div>
									{:else if layer.id === 'frost'}
										<div class="preview-frost"></div>
									{:else if layer.id === 'micro-events'}
										<div class="preview-micro"><div class="preview-star"></div></div>
									{:else if layer.id === 'weather'}
										<div class="preview-weather">
											<div class="preview-rain-near"></div>
											<div class="preview-rain-far"></div>
											<div class="preview-lightning"></div>
										</div>
									{:else if layer.id === 'clouds'}
										<div class="preview-clouds">
											<div class="preview-cloud near"></div>
											<div class="preview-cloud mid"></div>
											<div class="preview-cloud far"></div>
										</div>
									{:else if layer.id === 'color-grading'}
										<div class="preview-color-grading">
											<div class="preview-cg-before"></div>
											<div class="preview-cg-arrow">&rarr;</div>
											<div class="preview-cg-after"></div>
										</div>
									{:else if layer.id === 'bloom'}
										<div class="preview-bloom"><div class="preview-bloom-dot"></div></div>
									{:else if layer.id === 'viirs' || layer.id === 'roads' || layer.id === 'esri'}
										<div class="preview-imagery"><div class="preview-imagery-label">{layer.name}</div></div>
									{:else}
										<div class="preview-imagery"><div class="preview-imagery-label">{layer.name}</div></div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
					<span class="layer-chevron" class:open={expandedLayer === layer.id}>▸</span>
				</button>
			{/each}
		</div>
	</section>

	<hr class="divider" />

	<!-- ================================================================ -->
	<!-- SECTION 2: NIGHT RENDERING INSIGHT -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>The Night Rendering Insight</h2>
		<p class="section-desc">Why <code>terrainDarkness = 0</code> produces better night cities than darkening the terrain.</p>

		<div class="comparison">
			<div class="comparison-box bad">
				<div class="comparison-label">Darkened terrain</div>
				<div class="comparison-visual dark-terrain">
					<div class="pixel-grid">
						<div class="pixel" style:background="#0a0a0a"></div>
						<div class="pixel" style:background="#050505"></div>
						<div class="pixel" style:background="#111"></div>
						<div class="pixel" style:background="#080808"></div>
					</div>
				</div>
				<p class="comparison-note">Terrain brightness crushed → satellite detail lost → lights invisible in mud</p>
			</div>
			<div class="comparison-box good">
				<div class="comparison-label">Full brightness + shader</div>
				<div class="comparison-visual bright-terrain">
					<div class="pixel-grid">
						<div class="pixel" style:background="#ffa040"></div>
						<div class="pixel" style:background="#000"></div>
						<div class="pixel" style:background="#ffcc66"></div>
						<div class="pixel" style:background="#020202"></div>
					</div>
				</div>
				<p class="comparison-note">Satellite detail preserved → shader reads luminance → warm city glow emerges</p>
			</div>
		</div>

		<h3>Shader Pipeline</h3>
		<div class="flow-chart">
			<div class="flow-node">input pixel</div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">luminance<span class="flow-detail">dot(rgb, [.21, .72, .07])</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">lightMask<span class="flow-detail">smoothstep(0.12, 0.5, lum)</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">desaturate<span class="flow-detail">mix(rgb, gray, mask×0.8)</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node accent-sodium">sodium palette<span class="flow-detail">orange → amber → white</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">dark void<span class="flow-detail">crush non-city to black</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">horizon haze<span class="flow-detail">band at y=0.35</span></div>
			<div class="flow-arrow">→</div>
			<div class="flow-node">output</div>
		</div>
	</section>

	<hr class="divider" />

	<!-- ================================================================ -->
	<!-- SECTION 3: DATA SOURCES TABLE -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>Data Sources</h2>
		<p class="section-desc">External imagery and terrain providers powering the viewer.</p>

		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th></th>
						<th>Source</th>
						<th>Format</th>
						<th>Max Zoom</th>
						<th>Cost</th>
						<th>Role</th>
					</tr>
				</thead>
				<tbody>
					{#each dataSources as source}
						<tr>
							<td><span class="status-dot" style:background={statusColors[source.status]}></span></td>
							<td class="source-name">{source.name}</td>
							<td><code>{source.format}</code></td>
							<td>{source.maxZoom}</td>
							<td>{source.cost}</td>
							<td>{source.role}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="table-legend">
			<span><span class="status-dot" style:background="#4ade80"></span> Active</span>
			<span><span class="status-dot" style:background="#666"></span> Disabled</span>
			<span><span class="status-dot" style:background="#facc15"></span> Optional</span>
		</div>
	</section>

	<hr class="divider" />

	<!-- ================================================================ -->
	<!-- SECTION 4: RENDER PIPELINE -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>Render Pipeline</h2>
		<p class="section-desc">Per-frame execution flow driven by a single <code>requestAnimationFrame</code> loop.</p>

		<div class="pipeline">
			<div class="pipeline-row main-flow">
				<div class="pipe-node pipe-raf">RAF</div>
				<div class="pipe-arrow">→</div>
				<div class="pipe-node pipe-tick">model.tick(dt)</div>
				<div class="pipe-arrow">→</div>
				<div class="pipe-node pipe-derived">Svelte $derived</div>
				<div class="pipe-arrow">→</div>
				<div class="pipe-node pipe-effect">$effect sync</div>
				<div class="pipe-arrow">→</div>
				<div class="pipe-node pipe-gpu">Cesium GPU</div>
				<div class="pipe-arrow">→</div>
				<div class="pipe-node pipe-css">CSS composite</div>
			</div>

			<div class="pipeline-sub">
				<div class="sub-label">model.tick(dt) dispatches to:</div>
				<div class="sub-grid">
					<span class="sub-fn">tickFlightPath</span>
					<span class="sub-fn">tickScenario</span>
					<span class="sub-fn">tickOrbit</span>
					<span class="sub-fn">tickDeparture</span>
					<span class="sub-fn">tickTransit</span>
					<span class="sub-fn">tickDirector</span>
					<span class="sub-fn">tickLightning</span>
					<span class="sub-fn">tickMotion</span>
					<span class="sub-fn">tickAltitude</span>
					<span class="sub-fn">tickMicroEvents</span>
					<span class="sub-fn">tickRandomize</span>
				</div>
			</div>
		</div>

		<h3>Flight Mode State Machine</h3>
		<div class="state-machine">
			<div class="sm-node sm-orbit">orbit</div>
			<div class="sm-edge">
				<span class="sm-trigger">flyTo()</span>
				<span class="sm-arrow">→</span>
			</div>
			<div class="sm-node sm-departure">cruise_departure
				<span class="sm-note">warp ramp 0→1 (2.5s smoothstep), terrain rushes past, blind closes at 2.0s</span>
			</div>
			<div class="sm-edge">
				<span class="sm-trigger">2.0s</span>
				<span class="sm-arrow">→</span>
			</div>
			<div class="sm-node sm-transit">cruise_transit
				<span class="sm-note">teleport to new location, warp decays, blind opens at 2.0s</span>
			</div>
			<div class="sm-edge">
				<span class="sm-trigger">2.0s</span>
				<span class="sm-arrow">→</span>
			</div>
			<div class="sm-node sm-orbit">orbit</div>
		</div>
	</section>

	<hr class="divider" />

	<!-- ================================================================ -->
	<!-- SECTION 5: THE DIRECTOR (24h RHYTHM) -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>The Director — 24h Rhythm</h2>
		<p class="section-desc">Auto-pilot triggers <code>flyTo()</code> every 2–5 minutes during orbit. Location choice is weighted by time of day.</p>

		<div class="timeline-24h">
			{#each directorSegments as seg}
				<div
					class="timeline-segment"
					style:left="{(seg.start / 24) * 100}%"
					style:width="{((seg.end - seg.start) / 24) * 100}%"
					style:background={seg.color}
					title="{seg.label}: {seg.preference}"
				>
					<span class="seg-label">{seg.label}</span>
				</div>
			{/each}
			<div class="timeline-ticks">
				{#each [0, 3, 6, 9, 12, 15, 18, 21] as hour}
					<span class="tick" style:left="{(hour / 24) * 100}%">{hour}:00</span>
				{/each}
			</div>
		</div>

		<div class="director-rules">
			<div class="rule">
				<span class="rule-time">10:00–16:00 & 19:00–05:00</span>
				<span class="rule-pref">→ Prefer cities (buildings, lights)</span>
			</div>
			<div class="rule">
				<span class="rule-time">05:00–10:00 & 16:00–19:00</span>
				<span class="rule-pref">→ Prefer nature (mountains, ocean, desert)</span>
			</div>
			<div class="rule">
				<span class="rule-time">Hold timer</span>
				<span class="rule-pref">→ 120–300s (2–5 minutes) per location</span>
			</div>
		</div>

		<h3>Locations</h3>
		<div class="location-grid">
			<div class="loc-group">
				<span class="loc-label">Cities</span>
				<span class="loc-item">Dubai</span>
				<span class="loc-item">Mumbai</span>
				<span class="loc-item">Hyderabad</span>
				<span class="loc-item">Dallas</span>
				<span class="loc-item">Phoenix</span>
				<span class="loc-item">Las Vegas</span>
			</div>
			<div class="loc-group">
				<span class="loc-label">Nature</span>
				<span class="loc-item">Himalayas</span>
				<span class="loc-item">Pacific Ocean</span>
				<span class="loc-item">Sahara Desert</span>
				<span class="loc-item">Above Clouds</span>
			</div>
		</div>
	</section>

	<hr class="divider" />

	<!-- ================================================================ -->
	<!-- SECTION 6: STATE FLOW DIAGRAM -->
	<!-- ================================================================ -->

	<section class="section">
		<h2>State Flow</h2>
		<p class="section-desc">Data ownership and flow between modules.</p>

		<div class="state-flow">
			<div class="flow-row">
				<div class="module module-model">
					<div class="module-title">WindowModel</div>
					<div class="module-type">($state + $derived)</div>
					<div class="module-fields">
						<span>position, time, weather</span>
						<span>flight mode, motion, micro-events</span>
						<span>skyState, nightFactor, dawnDuskFactor</span>
						<span>effectiveCloudDensity, nightAltitudeTarget</span>
					</div>
				</div>
				<div class="flow-connector">
					<span class="connector-label">$derived</span>
					<span class="connector-arrow">→</span>
				</div>
				<div class="module module-sync">
					<div class="module-title">Sync Functions</div>
					<div class="module-type">($effect in components)</div>
					<div class="module-fields">
						<span>syncCamera()</span>
						<span>syncClock()</span>
						<span>syncAtmosphere()</span>
						<span>syncNightLayers()</span>
						<span>syncGlobe()</span>
					</div>
				</div>
				<div class="flow-connector">
					<span class="connector-arrow">→</span>
				</div>
				<div class="module module-output">
					<div class="module-title">Outputs</div>
					<div class="module-type">(GPU + CSS)</div>
					<div class="module-fields">
						<span>Cesium camera, clock, layers</span>
						<span>CSS variables, transforms</span>
						<span>Post-process uniforms</span>
					</div>
				</div>
			</div>
		</div>

		<h3>Component Ownership</h3>
		<div class="ownership-chart">
			<div class="own-node own-page">
				<span class="own-title">+page.svelte</span>
				<span class="own-detail">Clock sync, auto-save, URL params</span>
			</div>
			<div class="own-children">
				<div class="own-connector"></div>
				<div class="own-node own-window">
					<span class="own-title">Window.svelte</span>
					<span class="own-detail">RAF loop, presentation $derived, CSS layers</span>
				</div>
				<div class="own-children-inner">
					<div class="own-connector"></div>
					<div class="own-node own-cesium">
						<span class="own-title">CesiumViewer.svelte</span>
						<span class="own-detail">Terrain, imagery, GPU post-process, sync $effects</span>
					</div>
				</div>
				<div class="own-node own-controls">
					<span class="own-title">Controls.svelte</span>
					<span class="own-detail">HUD overlay, branding</span>
				</div>
				<div class="own-node own-panel">
					<span class="own-title">SidePanel.svelte</span>
					<span class="own-detail">Location picker, sliders, settings</span>
				</div>
			</div>
		</div>
	</section>

	<footer class="footer">
		<p>Sky Portal — Circadian-aware digital airplane window for office wellbeing</p>
	</footer>
</div>

<style>
	/* ================================================================ */
	/* BASE */
	/* ================================================================ */

	:global(body) {
		margin: 0;
		padding: 0;
		background: #0a0a1e;
		color: rgba(255, 255, 255, 0.85);
		font-family: 'Ubuntu', system-ui, -apple-system, sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	/* ================================================================ */
	/* NAV */
	/* ================================================================ */

	.top-nav {
		margin-bottom: 2rem;
	}

	.back-link {
		color: rgba(255, 255, 255, 0.5);
		text-decoration: none;
		font-size: 0.85rem;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: rgba(255, 255, 255, 0.85);
	}

	/* ================================================================ */
	/* HERO */
	/* ================================================================ */

	.hero {
		margin-bottom: 3rem;
	}

	h1 {
		font-size: 2.2rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		letter-spacing: -0.02em;
	}

	.subtitle {
		color: rgba(255, 255, 255, 0.5);
		font-size: 1rem;
		margin: 0;
		font-weight: 300;
	}

	/* ================================================================ */
	/* SECTIONS */
	/* ================================================================ */

	.section {
		margin-bottom: 1.5rem;
	}

	h2 {
		font-size: 1.4rem;
		font-weight: 700;
		margin: 0 0 0.4rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 500;
		margin: 2rem 0 0.75rem;
		color: rgba(255, 255, 255, 0.7);
	}

	.section-desc {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.9rem;
		margin: 0 0 1.5rem;
		line-height: 1.5;
	}

	code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.85em;
		color: rgba(255, 255, 255, 0.7);
		background: rgba(255, 255, 255, 0.05);
		padding: 0.15em 0.4em;
		border-radius: 3px;
	}

	.divider {
		border: none;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		margin: 3rem 0;
	}

	/* ================================================================ */
	/* SECTION 1: LAYER STACK */
	/* ================================================================ */

	.legend {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.layer-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.layer-bar {
		display: flex;
		align-items: stretch;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		padding: 0;
		transition: background 0.15s, border-color 0.15s;
		width: 100%;
	}

	.layer-bar:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.layer-bar.expanded {
		border-color: rgba(255, 255, 255, 0.15);
	}

	.layer-accent {
		width: 4px;
		flex-shrink: 0;
	}

	.layer-content {
		flex: 1;
		padding: 0.6rem 0.8rem;
		min-width: 0;
	}

	.layer-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.layer-name {
		font-weight: 500;
		font-size: 0.9rem;
	}

	.layer-z {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		color: rgba(255, 255, 255, 0.4);
		background: rgba(255, 255, 255, 0.06);
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
	}

	.layer-condition {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.35);
		margin-left: auto;
	}

	.layer-desc {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.5);
		margin: 0.3rem 0 0;
		line-height: 1.4;
	}

	.layer-details {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.detail-line {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.55);
		line-height: 1.8;
		padding-left: 0.5rem;
	}

	.layer-chevron {
		display: flex;
		align-items: center;
		padding: 0 0.6rem;
		color: rgba(255, 255, 255, 0.25);
		font-size: 0.8rem;
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.layer-chevron.open {
		transform: rotate(90deg);
	}

	/* ================================================================ */
	/* LAYER PREVIEWS */
	/* ================================================================ */

	.layer-preview {
		margin-top: 0.6rem;
		height: 150px;
		border-radius: 6px;
		overflow: hidden;
		position: relative;
		background: #0d0d20;
	}

	/* Glass frame preview */
	.preview-glass-frame {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-glass-frame .preview-inner {
		width: 60%;
		height: 75%;
		border-radius: 40%;
		background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
		box-shadow:
			inset 0 0 10px 4px rgba(0, 0, 0, 0.25),
			inset 2px 2px 6px rgba(0, 0, 0, 0.15);
	}

	/* Vignette preview */
	.preview-vignette {
		position: absolute;
		inset: 0;
		background: #4a7ab5;
	}

	.preview-vignette::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 75% 65% at 50% 50%,
			transparent 55%,
			rgba(0, 0, 0, 0.08) 80%,
			rgba(0, 0, 0, 0.5) 100%
		);
	}

	/* Glass surface preview */
	.preview-glass-surface {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #1a1a3a 0%, #0d0d20 100%);
	}

	.preview-glass-surface::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(
			circle at center,
			transparent 50%,
			rgba(0, 0, 0, 0.6) 100%
		);
		animation: preview-pulse 3s ease-in-out infinite alternate;
	}

	/* Wing preview */
	.preview-wing {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
	}

	.preview-wing-shape {
		position: absolute;
		bottom: -5%;
		left: -15%;
		width: 75%;
		height: 35%;
		background: linear-gradient(
			25deg,
			rgba(20, 20, 25, 0.7) 0%,
			rgba(30, 30, 35, 0.5) 20%,
			rgba(40, 40, 50, 0.25) 40%,
			transparent 60%
		);
		animation: preview-bank 6s ease-in-out infinite alternate;
		transform-origin: 80% 100%;
	}

	/* Frost preview */
	.preview-frost {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
	}

	.preview-frost::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 100% 100% at 50% 50%,
			transparent 40%,
			rgba(200, 220, 255, 0.4) 70%,
			rgba(180, 200, 255, 0.6) 90%
		);
		animation: preview-frost-breathe 8s ease-in-out infinite alternate;
	}

	/* Micro-events preview */
	.preview-micro {
		position: absolute;
		inset: 0;
		background: #0d0d20;
	}

	.preview-star {
		position: absolute;
		top: 20%;
		left: 30%;
		width: 2px;
		height: 60px;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.9) 0%,
			rgba(200, 220, 255, 0.5) 40%,
			transparent 100%
		);
		transform: rotate(-35deg);
		animation: preview-shoot 3s linear infinite;
	}

	/* Weather preview */
	.preview-weather {
		position: absolute;
		inset: 0;
		background: #2a2a40;
		overflow: hidden;
	}

	.preview-rain-near,
	.preview-rain-far {
		position: absolute;
		inset: -50%;
		background: repeating-linear-gradient(
			86deg,
			transparent 0px,
			transparent 4px,
			rgba(180, 200, 255, 0.3) 4px,
			rgba(180, 200, 255, 0.3) 5px
		);
	}

	.preview-rain-near {
		background-size: 100% 80px;
		animation: preview-rain 0.4s linear infinite;
	}

	.preview-rain-far {
		background-size: 100% 50px;
		opacity: 0.5;
		animation: preview-rain 0.6s linear infinite;
	}

	.preview-lightning {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 60% 50% at 40% 30%,
			rgba(200, 200, 255, 0.8) 0%,
			transparent 60%
		);
		mix-blend-mode: screen;
		animation: preview-flash 4s ease-in-out infinite;
	}

	/* Cloud preview (CSS version for architecture page) */
	.preview-clouds {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
	}

	.preview-cloud {
		position: absolute;
		inset: -20%;
		border-radius: 50%;
	}

	.preview-cloud.near {
		background: radial-gradient(
			ellipse 45% 30% at 25% 40%,
			rgba(255, 255, 255, 0.6) 0%,
			transparent 70%
		);
		filter: blur(8px);
		animation: preview-cloud-drift 6s linear infinite alternate;
	}

	.preview-cloud.mid {
		background: radial-gradient(
			ellipse 40% 28% at 60% 55%,
			rgba(240, 245, 255, 0.4) 0%,
			transparent 65%
		);
		filter: blur(12px);
		animation: preview-cloud-drift 8s linear infinite alternate-reverse;
	}

	.preview-cloud.far {
		background: radial-gradient(
			ellipse 55% 35% at 45% 50%,
			rgba(230, 240, 255, 0.25) 0%,
			transparent 60%
		);
		filter: blur(16px);
		animation: preview-cloud-drift 10s linear infinite alternate;
	}

	/* Color grading preview */
	.preview-color-grading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.preview-cg-before,
	.preview-cg-after {
		width: 40%;
		height: 80%;
		border-radius: 4px;
	}

	.preview-cg-before {
		background: linear-gradient(135deg, #333 0%, #555 40%, #222 60%, #444 100%);
	}

	.preview-cg-after {
		background: linear-gradient(135deg, #000 0%, #ffa040 30%, #000 50%, #ffcc66 80%, #000 100%);
		box-shadow: 0 0 20px rgba(255, 160, 64, 0.3);
	}

	.preview-cg-arrow {
		color: rgba(255, 255, 255, 0.3);
		font-size: 1.5rem;
	}

	/* Bloom preview */
	.preview-bloom {
		position: absolute;
		inset: 0;
		background: #050508;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-bloom-dot {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #ffa040;
		box-shadow:
			0 0 10px #ffa040,
			0 0 30px rgba(255, 160, 64, 0.5),
			0 0 60px rgba(255, 160, 64, 0.3);
		animation: preview-bloom-pulse 3s ease-in-out infinite alternate;
	}

	/* Imagery placeholder preview */
	.preview-imagery {
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, #1a2a4a 0%, #0a1a2a 100%);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-imagery-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		color: rgba(255, 255, 255, 0.25);
		border: 1px dashed rgba(255, 255, 255, 0.1);
		padding: 0.5rem 1rem;
		border-radius: 4px;
	}

	/* Preview animations */
	@keyframes preview-pulse {
		from { opacity: 0.2; }
		to { opacity: 0.4; }
	}

	@keyframes preview-bank {
		from { transform: rotate(-2deg); }
		to { transform: rotate(2deg); }
	}

	@keyframes preview-frost-breathe {
		from { opacity: 0.6; }
		to { opacity: 1; }
	}

	@keyframes preview-shoot {
		0% { transform: rotate(-35deg) translate(0, 0); opacity: 1; }
		30% { opacity: 0; }
		100% { transform: rotate(-35deg) translate(80px, 140px); opacity: 0; }
	}

	@keyframes preview-rain {
		from { transform: translate3d(0, -80px, 0); }
		to { transform: translate3d(0, 0, 0); }
	}

	@keyframes preview-flash {
		0%, 85%, 100% { opacity: 0; }
		88% { opacity: 0.8; }
		91% { opacity: 0; }
		93% { opacity: 0.4; }
	}

	@keyframes preview-cloud-drift {
		from { transform: translateX(-5%); }
		to { transform: translateX(5%); }
	}

	@keyframes preview-bloom-pulse {
		from { box-shadow: 0 0 10px #ffa040, 0 0 30px rgba(255, 160, 64, 0.5), 0 0 60px rgba(255, 160, 64, 0.3); }
		to { box-shadow: 0 0 15px #ffa040, 0 0 40px rgba(255, 160, 64, 0.6), 0 0 80px rgba(255, 160, 64, 0.4); }
	}

	/* ================================================================ */
	/* SECTION 2: NIGHT RENDERING */
	/* ================================================================ */

	.comparison {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	@media (max-width: 600px) {
		.comparison {
			grid-template-columns: 1fr;
		}
	}

	.comparison-box {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.02);
	}

	.comparison-box.bad {
		border-color: rgba(213, 21, 46, 0.3);
	}

	.comparison-box.good {
		border-color: rgba(74, 222, 128, 0.3);
	}

	.comparison-label {
		font-size: 0.8rem;
		font-weight: 500;
		margin-bottom: 0.75rem;
		color: rgba(255, 255, 255, 0.7);
	}

	.comparison-visual {
		height: 60px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.75rem;
	}

	.pixel-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2px;
		width: 60px;
		height: 40px;
	}

	.pixel {
		border-radius: 2px;
	}

	.dark-terrain {
		background: #050508;
	}

	.bright-terrain {
		background: #0a0a15;
	}

	.comparison-note {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 0;
		line-height: 1.5;
	}

	.flow-chart {
		display: flex;
		align-items: flex-start;
		gap: 0.3rem;
		flex-wrap: wrap;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		overflow-x: auto;
	}

	.flow-node {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.7);
		background: rgba(255, 255, 255, 0.05);
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.flow-node.accent-sodium {
		border-color: rgba(255, 160, 64, 0.3);
		background: rgba(255, 160, 64, 0.05);
	}

	.flow-detail {
		font-size: 0.62rem;
		color: rgba(255, 255, 255, 0.35);
	}

	.flow-arrow {
		color: rgba(255, 255, 255, 0.2);
		font-size: 0.9rem;
		padding-top: 0.35rem;
	}

	/* ================================================================ */
	/* SECTION 3: DATA SOURCES TABLE */
	/* ================================================================ */

	.table-wrapper {
		overflow-x: auto;
		margin-bottom: 0.75rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	th {
		text-align: left;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.5);
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	td {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		color: rgba(255, 255, 255, 0.65);
		vertical-align: top;
	}

	td code {
		font-size: 0.72rem;
	}

	.source-name {
		font-weight: 500;
		color: rgba(255, 255, 255, 0.8);
	}

	.status-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.table-legend {
		display: flex;
		gap: 1.2rem;
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.4);
	}

	.table-legend span {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* ================================================================ */
	/* SECTION 4: RENDER PIPELINE */
	/* ================================================================ */

	.pipeline {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		padding: 1.2rem;
	}

	.main-flow {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-bottom: 1.2rem;
	}

	.pipe-node {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		padding: 0.35rem 0.6rem;
		border-radius: 4px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		white-space: nowrap;
	}

	.pipe-raf { background: rgba(213, 21, 46, 0.1); border-color: rgba(213, 21, 46, 0.3); }
	.pipe-tick { background: rgba(48, 76, 178, 0.1); border-color: rgba(48, 76, 178, 0.3); }
	.pipe-derived { background: rgba(255, 191, 39, 0.1); border-color: rgba(255, 191, 39, 0.3); }
	.pipe-effect { background: rgba(255, 191, 39, 0.08); border-color: rgba(255, 191, 39, 0.2); }
	.pipe-gpu { background: rgba(74, 222, 128, 0.08); border-color: rgba(74, 222, 128, 0.2); }
	.pipe-css { background: rgba(213, 21, 46, 0.08); border-color: rgba(213, 21, 46, 0.2); }

	.pipe-arrow {
		color: rgba(255, 255, 255, 0.2);
		font-size: 0.85rem;
	}

	.pipeline-sub {
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.sub-label {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin-bottom: 0.5rem;
	}

	.sub-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.sub-fn {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.68rem;
		color: rgba(255, 255, 255, 0.55);
		background: rgba(48, 76, 178, 0.08);
		border: 1px solid rgba(48, 76, 178, 0.15);
		padding: 0.2rem 0.5rem;
		border-radius: 3px;
	}

	/* State machine */

	.state-machine {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}

	.sm-node {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		padding: 0.5rem 0.7rem;
		border-radius: 4px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.03);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.sm-orbit { border-color: rgba(74, 222, 128, 0.3); }
	.sm-departure { border-color: rgba(255, 191, 39, 0.3); }
	.sm-transit { border-color: rgba(48, 76, 178, 0.3); }

	.sm-note {
		font-size: 0.62rem;
		color: rgba(255, 255, 255, 0.35);
		font-family: 'Ubuntu', sans-serif;
		max-width: 180px;
	}

	.sm-edge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding-top: 0.3rem;
	}

	.sm-trigger {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		color: rgba(255, 255, 255, 0.35);
	}

	.sm-arrow {
		color: rgba(255, 255, 255, 0.2);
		font-size: 0.9rem;
	}

	/* ================================================================ */
	/* SECTION 5: DIRECTOR */
	/* ================================================================ */

	.timeline-24h {
		position: relative;
		height: 48px;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.timeline-segment {
		position: absolute;
		top: 0;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid rgba(0, 0, 0, 0.3);
	}

	.seg-label {
		font-size: 0.65rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.8);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 0.3rem;
	}

	.timeline-ticks {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 16px;
	}

	.tick {
		position: absolute;
		font-size: 0.6rem;
		color: rgba(255, 255, 255, 0.3);
		transform: translateX(-50%);
		font-family: 'JetBrains Mono', monospace;
	}

	.director-rules {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-top: 1rem;
	}

	.rule {
		display: flex;
		gap: 0.5rem;
		font-size: 0.8rem;
		align-items: baseline;
	}

	.rule-time {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.5);
		min-width: 200px;
	}

	.rule-pref {
		color: rgba(255, 255, 255, 0.65);
	}

	.location-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 500px) {
		.location-grid {
			grid-template-columns: 1fr;
		}
	}

	.loc-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}

	.loc-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.5);
		width: 100%;
		margin-bottom: 0.2rem;
	}

	.loc-item {
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.6);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 0.2rem 0.5rem;
		border-radius: 3px;
	}

	/* ================================================================ */
	/* SECTION 6: STATE FLOW */
	/* ================================================================ */

	.state-flow {
		margin-bottom: 2rem;
	}

	.flow-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.module {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: 0.8rem;
		background: rgba(255, 255, 255, 0.02);
		flex: 1;
		min-width: 180px;
	}

	.module-model { border-color: rgba(48, 76, 178, 0.3); }
	.module-sync { border-color: rgba(255, 191, 39, 0.3); }
	.module-output { border-color: rgba(74, 222, 128, 0.3); }

	.module-title {
		font-weight: 500;
		font-size: 0.85rem;
		margin-bottom: 0.1rem;
	}

	.module-type {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		color: rgba(255, 255, 255, 0.35);
		margin-bottom: 0.5rem;
	}

	.module-fields {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.module-fields span {
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.5);
		font-family: 'JetBrains Mono', monospace;
	}

	.flow-connector {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding-top: 1.2rem;
		flex-shrink: 0;
	}

	.connector-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6rem;
		color: rgba(255, 255, 255, 0.3);
	}

	.connector-arrow {
		color: rgba(255, 255, 255, 0.2);
		font-size: 1rem;
	}

	/* Component ownership */

	.ownership-chart {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		padding: 1.2rem;
	}

	.own-node {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		padding: 0.5rem 0.7rem;
		background: rgba(255, 255, 255, 0.03);
		margin-bottom: 0.3rem;
	}

	.own-page { border-color: rgba(213, 21, 46, 0.3); }
	.own-window { border-color: rgba(255, 191, 39, 0.3); }
	.own-cesium { border-color: rgba(48, 76, 178, 0.3); }
	.own-controls { border-color: rgba(255, 255, 255, 0.08); }
	.own-panel { border-color: rgba(255, 255, 255, 0.08); }

	.own-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		font-weight: 500;
	}

	.own-detail {
		display: block;
		font-size: 0.68rem;
		color: rgba(255, 255, 255, 0.4);
		margin-top: 0.15rem;
	}

	.own-children {
		padding-left: 1.5rem;
		margin-top: 0.3rem;
	}

	.own-children-inner {
		padding-left: 1.5rem;
	}

	.own-connector {
		width: 1px;
		height: 8px;
		background: rgba(255, 255, 255, 0.08);
		margin-left: 1rem;
	}

	/* ================================================================ */
	/* FOOTER */
	/* ================================================================ */

	.footer {
		margin-top: 4rem;
		padding-top: 2rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		text-align: center;
	}

	.footer p {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.25);
		margin: 0;
	}
</style>

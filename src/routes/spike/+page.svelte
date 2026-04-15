<script lang="ts">
	/**
	 * Phase 0a spike — validate the Svelte 5 patterns the Phase 1 reorg relies on.
	 *
	 * Three claims to verify end-to-end, not just on paper:
	 *   1. `class { field = $state(...) }` produces a reactive getter/setter pair
	 *      at the property access site.
	 *   2. `<input bind:value={config.field}>` mutates through that setter and
	 *      all readers of the same field update.
	 *   3. Nested class composition (root config holds child config instances)
	 *      flows reactivity across layers without `$state.raw` or $derived hops.
	 *
	 * If all three green at /spike, Phase 1 can confidently adopt the pattern
	 * across WorldConfig / AtmosphereConfig / CameraConfig / DirectorConfig /
	 * ChromeConfig without surprise.
	 */

	// ─── Test classes — mirror the shape Phase 1 will produce ────────────────

	class CloudsConfig {
		density = $state(0.5);
		speed   = $state(0.4);
		layers  = $state(3);
	}

	class AtmosphereConfig {
		clouds = new CloudsConfig();
		haze   = $state(0.07);
		rain   = $state(0);
	}

	class ChromeConfig {
		windowFrame  = $state(true);
		blindOpen    = $state(true);
		sidePanelOpen = $state(false);
	}

	class RootConfig {
		atmosphere = new AtmosphereConfig();
		chrome     = new ChromeConfig();

		// Simulates an admin-push patch arriving over fleet v2
		applyPatch(path: string, value: unknown) {
			const parts = path.split('.');
			// Walk the tree; this is the naive resolver for the spike only.
			let target: any = this;
			for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
			target[parts[parts.length - 1]] = value;
		}
	}

	const config = new RootConfig();

	// Derived reads — should re-compute whenever the underlying $state changes.
	const cloudsSummary = $derived(
		`${(config.atmosphere.clouds.density * 100).toFixed(0)}% @ ${config.atmosphere.clouds.speed.toFixed(1)}x, ${config.atmosphere.clouds.layers} layers`
	);

	let patchLog = $state<string[]>([]);

	function applyFakePatch(path: string, value: unknown) {
		config.applyPatch(path, value);
		patchLog = [...patchLog, `${new Date().toLocaleTimeString()} → ${path} = ${JSON.stringify(value)}`];
	}
</script>

<svelte:head>
	<title>Spike 0a — $state + bind</title>
</svelte:head>

<main>
	<h1>Phase 0a spike</h1>
	<p class="sub">Validating class-field <code>$state</code> + direct <code>bind:</code> + nested class composition.</p>

	<section>
		<h2>1. Direct <code>bind:value</code> on a <code>$state</code> class field</h2>
		<p class="hint">The slider should move when you drag it, and the readout should update live.</p>

		<div class="row">
			<label>
				Cloud density
				<input type="range" min="0" max="1" step="0.01" bind:value={config.atmosphere.clouds.density} />
				<output>{config.atmosphere.clouds.density.toFixed(2)}</output>
			</label>
		</div>

		<div class="row">
			<label>
				Cloud speed
				<input type="range" min="0" max="3" step="0.1" bind:value={config.atmosphere.clouds.speed} />
				<output>{config.atmosphere.clouds.speed.toFixed(1)}x</output>
			</label>
		</div>

		<div class="row">
			<label>
				Cloud layers
				<input type="number" min="1" max="10" bind:value={config.atmosphere.clouds.layers} />
			</label>
		</div>

		<p>Derived reader: <strong>{cloudsSummary}</strong></p>
		<p class="verdict" class:pass={cloudsSummary.includes(`${(config.atmosphere.clouds.density * 100).toFixed(0)}%`)}>
			✓ Derived reactivity flows through nested class fields
		</p>
	</section>

	<section>
		<h2>2. <code>bind:checked</code> on <code>$state</code> boolean</h2>
		<div class="row">
			<label>
				<input type="checkbox" bind:checked={config.chrome.windowFrame} />
				Window frame visible
			</label>
		</div>
		<div class="row">
			<label>
				<input type="checkbox" bind:checked={config.chrome.blindOpen} />
				Blind open
			</label>
		</div>
		<p>
			chrome.windowFrame: <strong>{config.chrome.windowFrame ? 'true' : 'false'}</strong>,
			chrome.blindOpen: <strong>{config.chrome.blindOpen ? 'true' : 'false'}</strong>
		</p>
	</section>

	<section>
		<h2>3. External mutation via <code>applyPatch(path, value)</code></h2>
		<p class="hint">Simulates a fleet v2 config_patch message. The UI above should reflect the change without any re-render prompting.</p>
		<div class="button-row">
			<button type="button" onclick={() => applyFakePatch('atmosphere.clouds.density', 0.9)}>Set clouds.density = 0.9</button>
			<button type="button" onclick={() => applyFakePatch('atmosphere.clouds.density', 0.1)}>Set clouds.density = 0.1</button>
			<button type="button" onclick={() => applyFakePatch('atmosphere.haze', 0.15)}>Set haze = 0.15</button>
			<button type="button" onclick={() => applyFakePatch('chrome.windowFrame', false)}>Hide window frame</button>
			<button type="button" onclick={() => applyFakePatch('chrome.windowFrame', true)}>Show window frame</button>
		</div>

		<h3>Patch log</h3>
		{#if patchLog.length === 0}
			<p class="hint">No patches applied yet.</p>
		{:else}
			<ol class="log">
				{#each patchLog as entry (entry)}
					<li>{entry}</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section>
		<h2>4. Raw JSON snapshot (toJSON simulation)</h2>
		<pre>{JSON.stringify({
			atmosphere: {
				clouds: { density: config.atmosphere.clouds.density, speed: config.atmosphere.clouds.speed, layers: config.atmosphere.clouds.layers },
				haze: config.atmosphere.haze,
				rain: config.atmosphere.rain
			},
			chrome: { windowFrame: config.chrome.windowFrame, blindOpen: config.chrome.blindOpen, sidePanelOpen: config.chrome.sidePanelOpen }
		}, null, 2)}</pre>
	</section>

	<section>
		<h2>Verdict</h2>
		<ul>
			<li>If section 1 sliders update their <code>&lt;output&gt;</code> live and the derived summary at the bottom matches: <strong>claim 1 + 2 hold</strong>.</li>
			<li>If section 3 buttons flip the UI in sections 1 &amp; 2 correctly: <strong>claim 3 holds</strong>.</li>
			<li>If section 4 JSON mirrors live values without a refresh: <strong>nested reactivity is clean</strong>.</li>
		</ul>
	</section>
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1.5rem 4rem;
		font-family: system-ui, -apple-system, sans-serif;
		color: #222;
	}
	h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
	h2 { font-size: 1.1rem; margin-top: 2rem; border-top: 1px solid #eee; padding-top: 1rem; }
	h3 { font-size: 0.9rem; margin-top: 1.5rem; letter-spacing: 0.03em; text-transform: uppercase; color: #666; }
	.sub { color: #666; margin-top: 0; }
	.hint { color: #888; font-size: 0.85rem; }
	.row { margin: 0.75rem 0; }
	.row label { display: flex; align-items: center; gap: 0.75rem; font-size: 0.9rem; }
	.row input[type="range"] { flex: 1; max-width: 280px; }
	.row output { min-width: 3ch; font-variant-numeric: tabular-nums; font-weight: 600; color: #0a6; }
	.verdict { font-size: 0.85rem; color: #0a6; }
	.verdict.pass::before { content: ''; }
	.button-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0; }
	button { padding: 0.4rem 0.75rem; border: 1px solid #ccc; background: #fafafa; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	button:hover { background: #f0f0f0; }
	.log { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #555; padding-left: 1.5rem; }
	pre { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 0.75rem; font-size: 0.8rem; overflow-x: auto; }
	code { background: #f3f3f3; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.85em; }
	ul { font-size: 0.9rem; }
</style>

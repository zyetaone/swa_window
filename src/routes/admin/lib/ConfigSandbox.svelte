<script lang="ts">
	/**
	 * ConfigSandbox — interactive sanity check for the Svelte 5 $state config
	 * pattern that Phase 1 of the reorg will build on. Previously lived at its
	 * own /spike route; folded into admin because admin is the natural home
	 * for "push config to device" testing.
	 *
	 * Validates three claims end-to-end:
	 *   1. class { field = $state(...) } produces reactive getter/setter pairs.
	 *   2. bind:value / bind:checked on class fields mutates through those
	 *      setters and all readers update.
	 *   3. Nested class composition flows reactivity across layers without
	 *      $state.raw or explicit $derived hops.
	 *
	 * Future: once the real WindowConfig classes land in Phase 1, swap the
	 * test classes below for imports of the live ones — this panel becomes a
	 * local-preview of what admin-push will actually mutate.
	 */

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

		applyPatch(path: string, value: unknown) {
			const parts = path.split('.');
			let target: any = this;
			for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
			target[parts[parts.length - 1]] = value;
		}
	}

	const config = new RootConfig();

	const cloudsSummary = $derived(
		`${(config.atmosphere.clouds.density * 100).toFixed(0)}% @ ${config.atmosphere.clouds.speed.toFixed(1)}x, ${config.atmosphere.clouds.layers} layers`,
	);

	let patchLog = $state<string[]>([]);

	function applyFakePatch(path: string, value: unknown) {
		config.applyPatch(path, value);
		patchLog = [...patchLog, `${new Date().toLocaleTimeString()} → ${path} = ${JSON.stringify(value)}`];
	}
</script>

<div class="sandbox">
	<p class="hint">
		Validates the Svelte 5 <code>$state</code> + <code>bind:</code> pattern that Phase 1 config classes rely on.
		Once Phase 1 ships, this panel will bind to the live <code>WindowConfig</code> classes instead of local test ones.
	</p>

	<div class="grid">
		<fieldset>
			<legend>1. <code>bind:value</code> on <code>$state</code> fields</legend>
			<label>
				Cloud density
				<input type="range" min="0" max="1" step="0.01" bind:value={config.atmosphere.clouds.density} />
				<output>{config.atmosphere.clouds.density.toFixed(2)}</output>
			</label>
			<label>
				Cloud speed
				<input type="range" min="0" max="3" step="0.1" bind:value={config.atmosphere.clouds.speed} />
				<output>{config.atmosphere.clouds.speed.toFixed(1)}x</output>
			</label>
			<label>
				Cloud layers
				<input type="number" min="1" max="10" bind:value={config.atmosphere.clouds.layers} />
			</label>
			<p class="derived">Derived: <strong>{cloudsSummary}</strong></p>
		</fieldset>

		<fieldset>
			<legend>2. <code>bind:checked</code> on <code>$state</code> booleans</legend>
			<label class="check">
				<input type="checkbox" bind:checked={config.chrome.windowFrame} />
				Window frame visible
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={config.chrome.blindOpen} />
				Blind open
			</label>
			<p class="derived">
				windowFrame: <strong>{config.chrome.windowFrame}</strong> ·
				blindOpen: <strong>{config.chrome.blindOpen}</strong>
			</p>
		</fieldset>
	</div>

	<fieldset>
		<legend>3. External mutation via <code>applyPatch(path, value)</code> — simulates fleet v2 push</legend>
		<div class="button-row">
			<button type="button" onclick={() => applyFakePatch('atmosphere.clouds.density', 0.9)}>density = 0.9</button>
			<button type="button" onclick={() => applyFakePatch('atmosphere.clouds.density', 0.1)}>density = 0.1</button>
			<button type="button" onclick={() => applyFakePatch('atmosphere.haze', 0.15)}>haze = 0.15</button>
			<button type="button" onclick={() => applyFakePatch('chrome.windowFrame', false)}>hide frame</button>
			<button type="button" onclick={() => applyFakePatch('chrome.windowFrame', true)}>show frame</button>
		</div>

		{#if patchLog.length > 0}
			<ol class="log">
				{#each patchLog as entry (entry)}
					<li>{entry}</li>
				{/each}
			</ol>
		{/if}
	</fieldset>

	<fieldset>
		<legend>4. Live JSON snapshot</legend>
		<pre>{JSON.stringify({
			atmosphere: {
				clouds: { density: config.atmosphere.clouds.density, speed: config.atmosphere.clouds.speed, layers: config.atmosphere.clouds.layers },
				haze: config.atmosphere.haze,
				rain: config.atmosphere.rain,
			},
			chrome: { windowFrame: config.chrome.windowFrame, blindOpen: config.chrome.blindOpen, sidePanelOpen: config.chrome.sidePanelOpen },
		}, null, 2)}</pre>
	</fieldset>
</div>

<style>
	.sandbox { font-size: 0.9rem; }
	.hint { color: #888; font-size: 0.85rem; margin-top: 0; }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
	@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
	fieldset { border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
	legend { font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(255, 255, 255, 0.6); padding: 0 0.5rem; }
	label { display: flex; align-items: center; gap: 0.6rem; margin: 0.5rem 0; font-size: 0.85rem; }
	label.check { gap: 0.4rem; }
	label input[type="range"] { flex: 1; max-width: 220px; }
	label output { min-width: 3ch; font-variant-numeric: tabular-nums; font-weight: 600; color: #7dd3a1; }
	.derived { font-size: 0.8rem; color: rgba(255, 255, 255, 0.75); margin: 0.25rem 0 0; }
	.button-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.25rem 0 0.75rem; }
	button { padding: 0.3rem 0.6rem; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.05); color: inherit; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
	button:hover { background: rgba(255, 255, 255, 0.1); }
	.log { font-family: ui-monospace, monospace; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7); padding-left: 1.25rem; margin: 0.25rem 0 0; max-height: 120px; overflow-y: auto; }
	pre { background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 0.5rem; font-size: 0.72rem; overflow-x: auto; color: rgba(255, 255, 255, 0.85); }
	code { background: rgba(255, 255, 255, 0.08); padding: 0.05rem 0.3rem; border-radius: 3px; font-size: 0.85em; }
</style>

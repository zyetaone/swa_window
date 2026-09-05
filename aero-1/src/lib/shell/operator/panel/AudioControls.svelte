<script lang="ts">
	/**
	 * AudioControls — the cabin ambience mixer.
	 *
	 * Layers are independent faders over one master, so they overlap the way a
	 * real mixer does rather than switching between presets. Engine and weather
	 * are synthesized (no assets); music is an operator-supplied URL.
	 *
	 * Writes route through applyConfigPatch like every other panel — see
	 * AtmosphereControls' header for why direct `config.X = v` is wrong.
	 */
	import { patchNum, usePanelConfig } from './patch';
	import RangeSlider from './RangeSlider.svelte';
	import Toggle from './Toggle.svelte';

	const { cfg, patch } = usePanelConfig();

	const pct = (v: number) => Math.round(v * 100) + '%';
</script>

<section>
	<h4>Audio</h4>

	<Toggle
		label="Cabin Audio"
		checked={cfg.audio.enabled}
		onchange={(e) => patch('audio.enabled', e.currentTarget.checked)}
	/>

	<RangeSlider
		label="Master"
		min={0}
		max={1}
		step={0.05}
		value={cfg.audio.masterVolume}
		oninput={patchNum(patch, 'audio.masterVolume')}
		formatValue={pct}
	/>
	<RangeSlider
		label="Engine"
		min={0}
		max={1}
		step={0.05}
		value={cfg.audio.engineVolume}
		oninput={patchNum(patch, 'audio.engineVolume')}
		formatValue={pct}
	/>
	<RangeSlider
		label="Weather"
		min={0}
		max={1}
		step={0.05}
		value={cfg.audio.weatherVolume}
		oninput={patchNum(patch, 'audio.weatherVolume')}
		formatValue={pct}
	/>
	<RangeSlider
		label="Music"
		min={0}
		max={1}
		step={0.05}
		value={cfg.audio.musicVolume}
		oninput={patchNum(patch, 'audio.musicVolume')}
		formatValue={pct}
	/>

	<label class="url-row">
		<span>Music URL</span>
		<input
			type="url"
			placeholder="/media/bed.mp3 — leave empty for none"
			value={cfg.audio.musicUrl}
			onchange={(e) => patch('audio.musicUrl', e.currentTarget.value)}
		/>
	</label>

	<p class="note">
		Engine and weather are synthesized — no audio files ship with the product.
		Music is optional and plays on the centre pane only, so the three screens
		cannot phase against each other. Rejected URLs fall back to silence.
	</p>
</section>

<style>
	.url-row {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
	}

	.url-row input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.35rem 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.3);
		color: inherit;
		font: inherit;
	}

	.note {
		margin: 0.5rem 0 0;
		font-size: 0.68rem;
		line-height: 1.4;
		opacity: 0.6;
	}
</style>

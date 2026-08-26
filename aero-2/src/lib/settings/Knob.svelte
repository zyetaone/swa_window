<script lang="ts">
	/**
	 * Knob — one labelled slider, bound to one entry in KNOB_RANGE.
	 *
	 * Exists because this markup appeared twenty times, and each copy repeated
	 * the min, the max, the value, and the `config.set` call. Repetition that
	 * long is not just noise: it is twenty chances to reach for `bind:value` and
	 * skip the write gate, or to type a bound that disagrees with the clamp
	 * table.
	 *
	 * Taking `key` rather than a value means the range comes FROM the same table
	 * that does the clamping, so a slider cannot offer a value the gate will
	 * reject.
	 */
	import { KNOB_RANGE, type PaneSettings } from './settings.svelte.js';

	interface Props {
		config: PaneSettings;
		key: keyof typeof KNOB_RANGE;
		label: string;
		step?: number;
		/** How to render the live value. Defaults to a rounded integer. */
		format?: (v: number) => string;
	}

	const { config, key, label, step = 1, format }: Props = $props();

	const range = $derived(KNOB_RANGE[key]);
	const value = $derived(config[key] as number);
	const shown = $derived(format ? format(value) : String(Math.round(value)));
</script>

<label class="field">
	<span>{label} ({shown})</span>
	<input
		type="range"
		min={range[0]}
		max={range[1]}
		{step}
		{value}
		oninput={(e) => config.set(key, e.currentTarget.valueAsNumber)}
	/>
</label>

<style>
	/* Lives here, not in Settings.svelte: this component is the only thing that
	   renders a .field, and a style that outlives its markup is how dead CSS
	   accumulates. */
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.85rem;
		margin-bottom: 8px;
	}
	.field input[type='range'] {
		accent-color: var(--accent-cyan);
		cursor: pointer;
	}
</style>

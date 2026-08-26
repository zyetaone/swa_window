<script lang="ts">
	/**
	 * Knob — Dual-input control (Slider Range + Direct Number Input), bound to KNOB_RANGE.
	 */
	import { KNOB_RANGE, type PaneSettings } from './settings.svelte.js';

	interface Props {
		config: PaneSettings;
		key: keyof typeof KNOB_RANGE;
		label: string;
		step?: number;
		format?: (v: number) => string;
	}

	const { config, key, label, step = 1, format }: Props = $props();

	const range = $derived(KNOB_RANGE[key]);
	const value = $derived(config[key] as number);
	const displayValue = $derived(format ? format(value) : String(value));
</script>

<div class="field">
	<div class="field-header">
		<span class="field-label">{label}</span>
		<div class="field-value-group">
			{#if format}
				<span class="field-formatted">{displayValue}</span>
			{/if}
			<input
				type="number"
				class="field-num"
				min={range[0]}
				max={range[1]}
				{step}
				{value}
				onchange={(e) => {
					const val = e.currentTarget.valueAsNumber;
					if (!isNaN(val)) config.set(key, val);
				}}
				aria-label="{label} numeric value"
			/>
		</div>
	</div>
	<input
		type="range"
		class="field-range"
		min={range[0]}
		max={range[1]}
		{step}
		{value}
		oninput={(e) => config.set(key, e.currentTarget.valueAsNumber)}
		aria-label="{label} range slider"
	/>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.85rem;
		margin-bottom: 12px;
	}
	.field-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.field-label {
		color: #cbd5e1;
		font-weight: 500;
	}
	.field-value-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.field-formatted {
		font-size: 0.75rem;
		color: var(--accent-cyan, #38bdf8);
		font-family: monospace;
	}
	.field-num {
		width: 64px;
		padding: 2px 6px;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 4px;
		color: #f8fafc;
		font-size: 0.78rem;
		font-family: monospace;
		text-align: right;
	}
	.field-num:focus {
		outline: none;
		border-color: var(--accent-cyan, #38bdf8);
		box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
	}
	.field-range {
		accent-color: var(--accent-cyan, #38bdf8);
		cursor: pointer;
		width: 100%;
		height: 5px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.15);
	}
</style>

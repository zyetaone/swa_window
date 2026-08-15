<script lang="ts">
	/**
	 * TimeControl — "Real Time" toggle + manual time-of-day slider +
	 * optional IANA zone override (admin / ops).
	 *
	 * Real Time follows location.timeZone (DST-correct) unless
	 * director.daylight.timeZoneOverride is set.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { formatTime } from '$lib/utils';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';

	const model = useAeroWindow();

	const locationZone = $derived(model.currentLocation.timeZone);
	const override = $derived(model.config.director.daylight.timeZoneOverride ?? '');
	const effectiveZone = $derived(override.trim() || locationZone);

	/** Common admin overrides + the location's own zone first. */
	const ZONE_CHOICES = $derived.by(() => {
		const base = [
			locationZone,
			'UTC',
			'America/Chicago',
			'America/Denver',
			'America/Los_Angeles',
			'America/New_York',
			'Asia/Kolkata',
			'Asia/Dubai',
			'Europe/London',
		];
		return [...new Set(base.filter(Boolean))];
	});
</script>

<section>
	<h4>Time</h4>
	<Toggle
		label="Real Time"
		checked={model.syncToRealTime}
		onchange={() => { model.syncToRealTime = !model.syncToRealTime; }}
	/>

	{#if model.syncToRealTime}
		<label class="zone" for="tz-override">
			<span class="zone-label">Zone</span>
			<select
				id="tz-override"
				value={override.trim() ? override.trim() : ''}
				onchange={(e) => {
					const v = e.currentTarget.value;
					model.applyConfigPatch('director.daylight.timeZoneOverride', v);
					// Immediate refresh so the HUD does not wait for the 60 s sync.
					if (model.syncToRealTime) model.updateTimeFromSystem();
				}}
			>
				<option value="">Location ({locationZone})</option>
				{#each ZONE_CHOICES as z}
					{#if z !== locationZone}
						<option value={z}>{z}</option>
					{/if}
				{/each}
			</select>
		</label>
		<p class="zone-hint">{formatTime(model.localTimeOfDay)} · {effectiveZone}</p>
	{/if}

	{#if !model.syncToRealTime}
		<RangeSlider
			id="time"
			label="Time of Day"
			min={0}
			max={24}
			step={0.25}
			value={model.localTimeOfDay}
			formatValue={(v) => formatTime(v)}
			oninput={(e) => model.setTime(parseFloat(e.currentTarget.value))}
		/>
	{/if}
</section>

<style>
	.zone {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.55rem;
		font-size: 0.78rem;
		color: var(--text-dim, #a1a1aa);
	}
	.zone-label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.7rem; }
	.zone select {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text, #e4e4e7);
		border-radius: 4px;
		padding: 0.3rem 0.4rem;
		font-size: 0.8rem;
	}
	.zone-hint {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--muted, #71717a);
		font-variant-numeric: tabular-nums;
	}
</style>

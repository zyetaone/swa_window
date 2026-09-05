<script lang="ts">
	/**
	 * TimeControl — "Real Time" toggle + manual time-of-day slider +
	 * optional IANA zone override (admin / ops).
	 *
	 * Real Time follows location.timeZone (DST-correct) unless
	 * director.daylight.timeZoneOverride is set.
	 *
	 * Dual-tree: the kiosk SidePanel has an AeroWindow context (full UI);
	 * /admin does not, and gets only the zone override — syncToRealTime and
	 * the time slider are live-model concepts. Admin writes fan out to the
	 * fleet via the director.daylight.timeZoneOverride peer-sync path.
	 */
	import { tryUseAeroWindow } from '$lib/model/aero-window.svelte';
	import { resolveLocalHours } from '$lib/model/local-time';
	import { formatTime } from '$lib/utils';
	import { subscribeWallClock, wallClockNow } from '$lib/shell/passenger/wall-clock.svelte';
	import { usePanelConfig } from './patch';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';

	interface Props {
		/** IANA zone for the depicted location — admin passes scene.location; kiosk uses AeroWindow. */
		locationZone?: string;
		/** Fixed-offset fallback when zone is empty (admin scene picker). */
		locationUtcOffset?: number;
	}

	let { locationZone: locationZoneProp = '', locationUtcOffset }: Props = $props();

	const model = tryUseAeroWindow();
	const { cfg, patch } = usePanelConfig();

	const locationZone = $derived(model?.currentLocation.timeZone ?? locationZoneProp);
	const override = $derived(cfg.director.daylight.timeZoneOverride ?? '');
	const effectiveZone = $derived(override.trim() || locationZone);

	// Admin has no AeroWindow — tick the shared wall clock and preview fleet time.
	$effect(() => {
		if (model) return;
		return subscribeWallClock();
	});

	const displayTime = $derived.by(() => {
		if (model) return model.localTimeOfDay;
		wallClockNow();
		return resolveLocalHours({
			timeZone: locationZone || undefined,
			utcOffset: locationUtcOffset,
			zoneOverride: override,
		});
	});

	function setOverride(v: string) {
		patch('director.daylight.timeZoneOverride', v);
		// Immediate refresh so the kiosk HUD does not wait for the 60 s sync.
		if (model?.syncToRealTime) model.updateTimeFromSystem();
	}

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
	{#if model}
		<Toggle
			label="Real Time"
			checked={model.syncToRealTime}
			onchange={() => { model.syncToRealTime = !model.syncToRealTime; }}
		/>
	{/if}

	{#if !model || model.syncToRealTime}
		<label class="zone" for="tz-override">
			<span class="zone-label">Zone</span>
			<select
				id="tz-override"
				value={override.trim() ? override.trim() : ''}
				onchange={(e) => setOverride(e.currentTarget.value)}
			>
				<option value="">Location{locationZone ? ` (${locationZone})` : ' (auto)'}</option>
				{#each ZONE_CHOICES as z}
					{#if z !== locationZone}
						<option value={z}>{z}</option>
					{/if}
				{/each}
			</select>
		</label>
		<p class="zone-hint">
			{formatTime(displayTime)} · {effectiveZone || 'auto'}
			{#if !model}
				<span class="zone-admin-note"> — syncs live to fleet</span>
			{/if}
		</p>
	{/if}

	{#if model && !model.syncToRealTime}
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
	.zone-admin-note {
		color: var(--text-dim, #a1a1aa);
		font-size: 0.72rem;
	}
</style>

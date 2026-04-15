<script lang="ts">
	/**
	 * TimeControl — "Real Time" toggle + manual time-of-day slider.
	 * Manual slider only renders when real-time sync is off.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import { formatTime } from '$lib/utils';
	import Toggle from '../Toggle.svelte';
	import RangeSlider from '../RangeSlider.svelte';

	const model = useAppState();
</script>

<section>
	<h4>Time</h4>
	<Toggle
		label="Real Time"
		checked={model.syncToRealTime}
		onchange={() => model.applyPatch({ syncToRealTime: !model.syncToRealTime })}
	/>

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

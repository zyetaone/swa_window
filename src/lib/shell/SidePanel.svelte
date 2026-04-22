<script lang="ts">
	/**
	 * SidePanel — right-side slide-out shell.
	 *
	 * The shell owns: open/close state + animation, tab button, backdrop,
	 * focus trap, and the fixed header (app title + flight-data readout +
	 * cruise-transition status).
	 *
	 * Inner content is composed at the page level via the `children` snippet.
	 * The usual composition lives in shell/panel/ — LocationPicker,
	 * TimeControl, FlightControls, AtmosphereControls, LightingControls,
	 * WeatherPicker. Pages can re-order, subset, or add their own sections
	 * without touching this shell.
	 */
	import type { Snippet } from 'svelte';
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { formatTime } from "$lib/utils";
	import AirlineLoader from "./AirlineLoader.svelte";

	let { children }: { children?: Snippet } = $props();

	const model = useAeroWindow();

	let panelOpen = $state(false);
	let closing = $state(false);

	let panelEl: HTMLDivElement | undefined = $state();
	let tabButtonEl: HTMLButtonElement | undefined = $state();

	function openPanel() {
		panelOpen = true;
	}

	function closePanel() {
		if (closing) return;
		closing = true;
		setTimeout(() => {
			panelOpen = false;
			closing = false;
			tabButtonEl?.focus();
		}, 200);
	}

	function togglePanel() {
		if (panelOpen) {
			closePanel();
		} else {
			openPanel();
		}
	}

	// Focus trap: when panel opens, focus the first interactive element
	$effect(() => {
		if (panelOpen && !closing && panelEl) {
			const firstFocusable = panelEl.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			firstFocusable?.focus();
		}
	});

	function handlePanelKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			closePanel();
			return;
		}

		if (e.key !== "Tab" || !panelEl) return;

		const focusable = Array.from(
			panelEl.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			),
		);

		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<!-- Tab button (always visible on right edge) -->
<button
	bind:this={tabButtonEl}
	class={['panel-tab', panelOpen && !closing && 'open']}
	onclick={togglePanel}
	type="button"
	aria-label={panelOpen ? "Close settings" : "Open settings"}
>
	<svg
		class="tab-icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		{#if panelOpen && !closing}
			<path d="M9 18l6-6-6-6" />
		{:else}
			<path d="M15 18l-6-6 6-6" />
		{/if}
	</svg>
</button>

<!-- Slide-out panel -->
{#if panelOpen}
	<button
		class={['backdrop', closing && 'closing']}
		onclick={closePanel}
		type="button"
		aria-label="Close settings panel"
		tabindex="-1"
	></button>

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={panelEl}
		class={['panel', closing && 'closing']}
		role="dialog"
		aria-label="Settings panel"
		tabindex="-1"
		onkeydown={handlePanelKeydown}
	>
		<header>
			<h2>Sky Portal</h2>
		</header>

		<!-- Flight Data -->
		<div class="flight-data">
			<div class="data-row">
				<div class="data-item">
					<span class="data-label">ALT</span>
					<span class="data-value"
						>{(model.flight.altitude / 1000).toFixed(1)}<small>k ft</small
						></span
					>
				</div>
				<div class="data-item">
					<span class="data-label">GS</span>
					<span class="data-value"
						>{model.flight.flightSpeed.toFixed(1)}<small>x</small></span
					>
				</div>
				<div class="data-item">
					<span class="data-label">LOC</span>
					<span class="data-value"
						>{formatTime(model.localTimeOfDay)}</span
					>
				</div>
			</div>
			<div class="current-location">{model.currentLocation.name}</div>
		</div>

		<!-- Transition status -->
		{#if model.flight.isTransitioning && model.flight.cruiseDestinationName}
			<div class="transition-status">
				<div class="loader-wrapper">
					<AirlineLoader />
				</div>
				<div class="status-text">
					<span class="dest-label">DESTINATION</span>
					<span class="dest-name">{model.flight.cruiseDestinationName}</span>
				</div>
			</div>
		{/if}

		<div class="divider"></div>

		<!-- Composed sections — page supplies via <SidePanel>…</SidePanel>.
		     See shell/panel/ for the stock components. -->
		<div class="settings">
			{@render children?.()}
		</div>

	</div>
{/if}

<style>
	/* --- Tab button --- */

	.panel-tab {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		z-index: 100;
		width: 44px;
		height: 64px;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-right: none;
		border-radius: 10px 0 0 10px;
		color: rgba(255, 255, 255, 0.8);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.panel-tab:hover {
		background: rgba(0, 0, 0, 0.55);
		color: white;
		width: 48px;
	}

	.panel-tab.open {
		right: 300px;
	}

	.tab-icon {
		width: 20px;
		height: 20px;
	}

	/* --- Backdrop --- */

	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 99;
		background: rgba(0, 0, 0, 0.15);
		border: none;
		cursor: default;
		padding: 0;
		animation: backdrop-fade-in 0.25s ease both;
	}

	.backdrop.closing {
		animation: backdrop-fade-out 0.2s ease both;
	}

	@keyframes backdrop-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes backdrop-fade-out {
		from { opacity: 1; }
		to { opacity: 0; }
	}

	/* --- Panel --- */

	.panel {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 300px;
		z-index: 100;
		background: rgba(10, 10, 30, 0.88);
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.9);
		overflow-y: auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		animation: panel-slide-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	.panel.closing {
		animation: panel-slide-out 0.2s cubic-bezier(0.4, 0, 0.8, 0.2) both;
	}

	@keyframes panel-slide-in {
		from {
			transform: translateX(100%);
			opacity: 0.8;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	@keyframes panel-slide-out {
		from {
			transform: translateX(0);
			opacity: 1;
		}
		to {
			transform: translateX(100%);
			opacity: 0.8;
		}
	}


	/* --- Header --- */

	header {
		text-align: left;
	}

	h2 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		background: linear-gradient(135deg, #fff 0%, #ccc 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		letter-spacing: -0.01em;
	}

	/* --- Flight Data --- */

	.flight-data {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 0.8rem;
	}

	.data-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.data-item {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.data-label {
		font-size: 0.625rem;
		opacity: 0.5;
		letter-spacing: 0.2em;
		font-weight: 400;
		margin-bottom: 0.15rem;
	}

	.data-value {
		font-family: "JetBrains Mono", "Fira Code", monospace;
		font-size: 0.85rem;
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	.data-value small {
		font-size: 0.7em;
		opacity: 0.6;
		margin-left: 0.15em;
	}

	.current-location {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 300;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.7;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 0.5rem;
	}

	/* --- Transition Status --- */

	.transition-status {
		background: rgba(0, 0, 0, 0.25);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.loader-wrapper {
		flex-shrink: 0;
	}

	.status-text {
		display: flex;
		flex-direction: column;
	}

	.dest-label {
		font-size: 0.65rem;
		opacity: 0.5;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.dest-name {
		font-size: 1rem;
		font-weight: 700;
		color: var(--sw-yellow);
	}

	/* --- Divider --- */

	.divider {
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.2),
			transparent
		);
	}

	/* Child panel sections live in their own components and use scoped
	   section + h4 + .divider markup. Since Svelte's style scoping is
	   per-file, we reach across via :global on these shared structural
	   elements only — individual widget styling stays local to its
	   section component. */
	.panel :global(section) {
		margin-bottom: 0.2rem;
	}

	.panel :global(h4) {
		margin: 0 0 0.4rem 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.55;
		font-weight: 500;
	}

	.panel :global(.divider) {
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.2),
			transparent
		);
		margin: 0.4rem 0;
	}

	/* --- Settings wrapper spacing --- */

	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	:global(.panel .control input[type="range"]) {
		background: rgba(255, 255, 255, 0.1);
	}
</style>

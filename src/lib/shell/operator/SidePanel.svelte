<script lang="ts">
	/**
	 * SidePanel — right-side slide-out shell.
	 *
	 * The shell owns: open/close state + animation, tab button, backdrop,
	 * focus trap, and the fixed header (app title + flight-data readout +
	 * cruise-transition status).
	 *
	 * Inner content is composed at the page level via the `children` snippet.
	 * The usual composition lives in shell/operator/panel/ — LocationPicker,
	 * TimeControl, FlightControls, AtmosphereControls, LightingControls,
	 * WeatherPicker. Pages can re-order, subset, or add their own sections
	 * without touching this shell.
	 */
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { onDestroy } from 'svelte';
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { config } from "$lib/model/config-tree.svelte";
	import { isOpsModeParam, showsOpsChrome } from '$lib/fleet/parallax.svelte';
	import { flightReadout } from "$lib/shell/passenger/hud/flight-readout";
	import AirlineLoader from "./AirlineLoader.svelte";

	let { children }: { children?: Snippet } = $props();

	const model = useAeroWindow();
	const stats = $derived(flightReadout(model));

	// Chrome role gates live in fleet/parallax — single SSOT with HUD.
	const role = $derived(model.config.camera.parallax.role);
	const opsMode = $derived.by(() =>
		typeof window === 'undefined' ? false : isOpsModeParam(window.location.search),
	);
	const showOpsChrome = $derived(showsOpsChrome(role, opsMode));

	let panelOpen = $state(false);
	let closing = $state(false);
	let dismissTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;


	function resetDismissTimer() {
		if (dismissTimer) clearTimeout(dismissTimer);
		// 0 disables auto-close — on-site techs flip to 0 in the side panel so
		// the panel stays open while they debug. Read once per reset; admin
		// changes take effect on the next reset (next open / next activity).
		const ms = config.shell.sidePanelAutoCloseMs;
		if (ms > 0) dismissTimer = setTimeout(() => closePanel(), ms);
	}

	function clearDismissTimer() {
		if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
	}

	// Tab button: kept as bind:this because closePanel() needs to refocus it
	// AFTER the panel unmounts (no live element to dispatch from at that point).
	// $state so bind:this satisfies Svelte 5 non_reactive_update (we only
	// use it for imperative focus, not template reads).
	let tabButtonEl = $state<HTMLButtonElement | undefined>();

	function openPanel() {
		panelOpen = true;
		resetDismissTimer();
	}

	function closePanel() {
		if (closing) return;
		clearDismissTimer();
		if (closeTimer) clearTimeout(closeTimer);
		closing = true;
		closeTimer = setTimeout(() => {
			panelOpen = false;
			closing = false;
			tabButtonEl?.focus();
			closeTimer = null;
		}, 200);
	}

	onDestroy(() => {
		if (dismissTimer) clearTimeout(dismissTimer);
		if (closeTimer) clearTimeout(closeTimer);
	});

	function togglePanel() {
		if (panelOpen) closePanel();
		else openPanel();
	}

	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
	/**
	 * Focus trap + Escape + Tab-cycle attachment for the modal panel. Replaces
	 * the earlier bind:this + $effect + onkeydown trio: lifecycle (mount/
	 * unmount), focus-first-element, and keyboard handling all live in one
	 * place tied to the element's own lifetime.
	 */
	const focusTrap: Attachment<HTMLDivElement> = (node) => {
		node.querySelector<HTMLElement>(FOCUSABLE)?.focus();

		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape") { closePanel(); return; }
			if (e.key !== "Tab") return;

			const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
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
		};

		node.addEventListener("keydown", onKeydown);
		return () => node.removeEventListener("keydown", onKeydown);
	};
</script>

{#if showOpsChrome}
<!-- Tab button (solo / center / ?ops=1 only — edge panes stay clean) -->
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
{/if}

<!-- Slide-out panel -->
{#if showOpsChrome && panelOpen}
	<button
		class={['backdrop', closing && 'closing']}
		onclick={closePanel}
		type="button"
		aria-label="Close settings panel"
		tabindex="-1"
	></button>

	<div
		class={['panel', closing && 'closing']}
		role="dialog"
		aria-label="Settings panel"
		tabindex="-1"
		onpointermove={resetDismissTimer}
		{@attach focusTrap}
	>
		<header>
			<h2>Aero Window</h2>
			<p class="panel-sub">Operator</p>
		</header>

		<!-- Flight Data -->
		<div class="flight-data">
			<div class="data-row">
				{#each stats as stat (stat.label)}
					<div class="data-item">
						<span class="data-label">{stat.label}</span>
						<span class="data-value">{stat.value}</span>
					</div>
				{/each}
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
		     See shell/operator/panel/ for the stock components. -->
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
		opacity: 0.35;
		transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.panel-tab:hover,
	.panel-tab:focus-visible {
		opacity: 1;
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
		font-weight: 500;
		color: rgba(255, 255, 255, 0.92);
		letter-spacing: 0.02em;
	}

	.panel-sub {
		margin: 0.2rem 0 0;
		font-size: 0.65rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.4;
		font-weight: 400;
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

	/* Shared structural elements — apply to both this file's markup and
	   child-component sections. Svelte's style scoping is per-file, so we
	   reach across via :global. Individual widget styling stays local to
	   its section component. */
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

	/* Shared picker styling — used by LocationPicker, WeatherPicker, and any
	   other panel section that needs a wrap-grid of toggleable buttons.
	   Children apply .picker-grid to the wrapper and .picker-btn to each
	   button; .active marks the current selection. */
	.panel :global(.picker-grid) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.panel :global(.picker-btn) {
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 5px;
		color: rgba(255, 255, 255, 0.85);
		cursor: pointer;
		text-align: center;
		transition: all 0.15s;
	}
	.panel :global(.picker-btn:hover) {
		background: rgba(255, 255, 255, 0.15);
		border-color: rgba(255, 255, 255, 0.25);
		color: white;
	}
	.panel :global(.picker-btn.active) {
		background: rgba(48, 76, 178, 0.45);
		border-color: var(--sw-blue);
		color: white;
		font-weight: 500;
		box-shadow: 0 0 8px rgba(48, 76, 178, 0.4);
	}

	/* --- Settings wrapper spacing --- */

	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	/* Advanced fold — atmosphere / lighting / lab. Closed by default so the
	   first screenful is place + weather + time + flight only. */
	.panel :global(details.advanced) {
		margin-top: 0.25rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 0.55rem;
	}
	.panel :global(details.advanced > summary) {
		list-style: none;
		cursor: pointer;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		opacity: 0.55;
		font-weight: 500;
		padding: 0.35rem 0;
		user-select: none;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.panel :global(details.advanced > summary::-webkit-details-marker) {
		display: none;
	}
	.panel :global(details.advanced > summary::before) {
		content: '▸';
		font-size: 0.65rem;
		opacity: 0.7;
		transition: transform 0.15s ease;
	}
	.panel :global(details.advanced[open] > summary::before) {
		transform: rotate(90deg);
	}
	.panel :global(details.advanced > summary:hover),
	.panel :global(details.advanced > summary:focus-visible) {
		opacity: 0.9;
		color: white;
	}
	.panel :global(details.advanced .advanced-body) {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding-top: 0.55rem;
	}

	:global(.panel .control input[type="range"]) {
		background: rgba(255, 255, 255, 0.1);
	}
</style>

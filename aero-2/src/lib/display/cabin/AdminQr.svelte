<script lang="ts">
	/**
	 * AdminQr — a long press on the kiosk reveals how to reach this device.
	 *
	 * THE PROBLEM IT SOLVES. A fielded Pi has no keyboard and no visible address.
	 * Reaching `/admin` means knowing the device's LAN IP, which means either
	 * scanning the network, reading a label somebody wrote at install time, or
	 * plugging in a screen. Every one of those is a site visit for a setting a
	 * phone could change in ten seconds.
	 *
	 * WHY A LONG PRESS. The kiosk is a public surface: a wall in an office, at
	 * shoulder height, that people walk past. A visible button gets pressed by
	 * anyone, and a keyboard shortcut needs a keyboard. Fifteen seconds of
	 * sustained contact is a deliberate act nobody performs by accident, and it
	 * needs nothing but the panel already on the wall.
	 *
	 * WHY NOT A SECRET. This shows a LAN address, not a credential. Anyone who
	 * can hold a finger on the glass for fifteen seconds is already standing in
	 * the room, and `/admin` is itself gated by `AERO_ADMIN_UI` and a bearer
	 * token for anything that mutates. The QR removes a transcription step; it
	 * does not remove an authorisation.
	 */
	import { onDestroy } from 'svelte';
	import { qrSvg } from '#lib/qr.js';
	import { fetchStatus, adminUrl } from '#lib/status.js';

	/**
	 * Fifteen seconds, and the number matters in both directions.
	 *
	 * Shorter and a leaning elbow or a child's palm opens it. Longer and the
	 * person who was told "hold the screen" gives up before it appears — so the
	 * progress ring exists to say "keep going", which is the only reason a
	 * fifteen-second gesture is usable at all.
	 */
	const HOLD_MS = 15_000;
	/** Long enough to walk to a phone and scan; short enough not to be signage. */
	const VISIBLE_MS = 60_000;

	let heldMs = $state(0);
	let url = $state<string | null>(null);
	let error = $state<string | null>(null);
	let holdTimer: ReturnType<typeof setInterval> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	const progress = $derived(Math.min(1, heldMs / HOLD_MS));
	const svg = $derived(url ? qrSvg(url) : null);

	function clearHold() {
		if (holdTimer) clearInterval(holdTimer);
		holdTimer = null;
		heldMs = 0;
	}

	/**
	 * Ask the device where it lives.
	 *
	 * `/api/status` already reports `primaryLanIp` and `port` for the admin
	 * cockpit, so this needs no new endpoint — and it is the same source
	 * `health-check.sh` scrapes, which means the QR cannot disagree with what
	 * the fleet reports. The URL itself is built in `lib/status.ts`, because
	 * nothing under `display/` may name a protocol.
	 *
	 * A failure shows the reason rather than nothing. "No LAN address" on a
	 * device with no network is the answer, and it tells the person holding the
	 * screen to check the cable instead of holding it again.
	 */
	async function reveal() {
		clearHold();
		try {
			const next = adminUrl(await fetchStatus());
			if (next) {
				url = next;
				error = null;
			} else {
				error = 'No LAN address — this device is not on a network.';
				url = null;
			}
		} catch {
			error = 'Could not read this device’s address.';
			url = null;
		}
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(dismiss, VISIBLE_MS);
	}

	function dismiss() {
		url = null;
		error = null;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = null;
	}

	function onPointerDown() {
		if (url || error) return; // already open
		clearHold();
		const startedAt = Date.now();
		holdTimer = setInterval(() => {
			heldMs = Date.now() - startedAt;
			if (heldMs >= HOLD_MS) void reveal();
		}, 100);
	}

	onDestroy(() => {
		clearHold();
		if (hideTimer) clearTimeout(hideTimer);
	});
</script>

<!--
	The hit area sits in a CORNER, not across the glass.

	A full-surface listener would fight the blind, which owns pointer events for
	its own drag — and the blind is the one gesture a passenger is meant to
	find. A corner is out of the way of both, and out of the way of the view.
-->
<div
	class="qr-hotspot"
	onpointerdown={onPointerDown}
	onpointerup={clearHold}
	onpointercancel={clearHold}
	onpointerleave={clearHold}
	role="button"
	tabindex="-1"
	aria-label="Hold to show the admin address"
></div>

{#if progress > 0.08 && !url && !error}
	<!-- Feedback only after the press is clearly deliberate: a flicker on every
	     incidental touch would be its own kind of noise on a public wall. -->
	<div class="qr-progress" aria-hidden="true">
		<div class="qr-progress-fill" style:width="{progress * 100}%"></div>
	</div>
{/if}

{#if url || error}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="qr-backdrop" onclick={dismiss}>
		<div class="qr-card">
			{#if url && svg}
				<p class="qr-title">Scan to open the admin panel</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="qr-code">{@html svg}</div>
				<!-- The address in text as well, because a QR is unreadable to a
				     person and a phone camera can fail on a glossy panel. -->
				<p class="qr-url">{url}</p>
			{:else}
				<p class="qr-title">Admin unavailable</p>
				<p class="qr-url">{error}</p>
			{/if}
			<p class="qr-dismiss">Tap anywhere to dismiss</p>
		</div>
	</div>
{/if}

<style>
	.qr-hotspot {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 12vmin;
		height: 12vmin;
		/* Invisible on purpose: discoverable by instruction, not by appearance. */
		opacity: 0;
		z-index: 40;
		touch-action: none;
	}

	.qr-progress {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 3px;
		width: 12vmin;
		background: rgba(255, 255, 255, 0.12);
		z-index: 41;
		pointer-events: none;
	}
	.qr-progress-fill {
		height: 100%;
		background: rgba(255, 255, 255, 0.75);
		transition: width 0.1s linear;
	}

	.qr-backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.72);
		z-index: 50;
	}

	.qr-card {
		background: #fff;
		color: #111;
		border-radius: 12px;
		padding: 1.5rem 1.75rem;
		text-align: center;
		font-family: system-ui, sans-serif;
		max-width: min(80vw, 380px);
	}

	.qr-title {
		margin: 0 0 1rem;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.qr-code {
		width: min(52vmin, 260px);
		margin: 0 auto;
	}
	.qr-code :global(svg) {
		width: 100%;
		height: auto;
		display: block;
	}

	.qr-url {
		margin: 1rem 0 0;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
		word-break: break-all;
	}

	.qr-dismiss {
		margin: 0.75rem 0 0;
		font-size: 0.75rem;
		opacity: 0.55;
	}
</style>

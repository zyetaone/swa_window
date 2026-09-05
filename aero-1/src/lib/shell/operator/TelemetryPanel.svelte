<script lang="ts">
	/**
	 * TelemetryPanel — in-window observability viewer.
	 *
	 * Lives on the main display (/), toggled via Shift+T. Admin is the fleet
	 * hub and has no local AeroWindow — remote telemetry polling is a
	 * separate concern (Phase 5.7+).
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { APP_COMMIT } from '$lib/version';

	const model = useAeroWindow();
	const telemetry = model.telemetry;

	let visible = $state(false);

	// Shift+T toggles visibility. Listener attached via <svelte:window> below
	// per Svelte 5 best practices (preferred over addEventListener in $effect).
	function handleKey(e: KeyboardEvent) {
		if (!e.shiftKey) return;
		if (e.key !== 'T' && e.key !== 't') return;
		// Respect focus in text-entry elements — same rule as the 'F' toggle.
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
		e.preventDefault();
		visible = !visible;
	}

	const frameP50 = $derived(telemetry.frameMsP50);
	const frameP95 = $derived(telemetry.frameMsP95);
	const tickP50 = $derived(telemetry.tickMsP50);
	const counts = $derived(telemetry.counts);
	// Most recent first, cap visible to 50 entries.
	const recentEvents = $derived([...telemetry.events].slice(-50).reverse());

	function formatTimestamp(t: number): string {
		const d = new Date(t);
		const hh = d.getHours().toString().padStart(2, '0');
		const mm = d.getMinutes().toString().padStart(2, '0');
		const ss = d.getSeconds().toString().padStart(2, '0');
		const cs = ((d.getMilliseconds() / 10) | 0).toString().padStart(2, '0');
		return `${hh}:${mm}:${ss}.${cs}`;
	}

	function previewPayload(payload: unknown): string {
		if (payload == null) return '';
		try {
			const s = JSON.stringify(payload);
			return s.length > 120 ? s.slice(0, 117) + '...' : s;
		} catch {
			return String(payload);
		}
	}

	function exportJson() {
		if (typeof window === 'undefined') return;
		const snap = telemetry.toJSON();
		const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `telemetry-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function clearAll() {
		telemetry.clear();
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if visible}
	<div class="panel" role="dialog" aria-label="Telemetry">
		<header>
			<h3>Telemetry <span class="commit">{APP_COMMIT}</span></h3>
			<div class="actions">
				<button type="button" onclick={exportJson}>Export</button>
				<button type="button" onclick={clearAll}>Clear</button>
				<button type="button" aria-label="Close" onclick={() => (visible = false)}>×</button>
			</div>
		</header>

		<section class="stats">
			<div class="stat">
				<span class="label">Frame p50</span>
				<span class="value">{frameP50.toFixed(1)} ms</span>
			</div>
			<div class="stat">
				<span class="label">Frame p95</span>
				<span class="value">{frameP95.toFixed(1)} ms</span>
			</div>
			<div class="stat">
				<span class="label">FPS</span>
				<span class="value">{model.measuredFps || '—'}</span>
			</div>
			<div class="stat">
				<span class="label">FPS low</span>
				<span class="value">{telemetry.fpsLow || '—'}</span>
			</div>
			<div class="stat">
				<span class="label">Tick p50</span>
				<span class="value">{tickP50.toFixed(2)} ms</span>
			</div>
		</section>

		<section class="counts">
			<div class="count"><span>Patches</span><strong>{counts.configPatches}</strong></div>
			<div class="count"><span>Fleet in</span><strong>{counts.fleetIn}</strong></div>
			<div class="count"><span>Fleet out</span><strong>{counts.fleetOut}</strong></div>
			<div class="count"><span>Errors</span><strong>{counts.errors}</strong></div>
		</section>

		<section class="events">
			<h4>Recent events ({recentEvents.length})</h4>
			<ul>
				{#each recentEvents as evt (evt)}
					<li class="evt kind-{evt.kind}">
						<span class="t">{formatTimestamp(evt.t)}</span>
						<span class="kind">{evt.kind}</span>
						<span class="payload">{previewPayload(evt.payload)}</span>
					</li>
				{/each}
				{#if recentEvents.length === 0}
					<li class="empty">No events yet.</li>
				{/if}
			</ul>
		</section>

		<footer>
			<small>Shift+T to toggle</small>
		</footer>
	</div>
{/if}

<style>
	.panel {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 10000;
		width: 420px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		/* Same ops surface as SidePanel .panel — the two can be open at once
		   and must read as one material. No backdrop-filter: SidePanel has
		   none, and the Pi 5 budget allows no extra blur passes. */
		background: rgba(10, 10, 30, 0.88);
		color: var(--text);
		border: 1px solid rgba(255, 255, 255, 0.1);
		/* Floating card, so it needs the radius SidePanel (full-height) omits;
		   8px matches the shell's card idiom (flight-data wells). */
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		/* Ubuntu (inherited from the kiosk body) for chrome/labels; JetBrains
		   Mono is scoped to numbers and log payloads below — flight-data idiom. */
		font-size: 12px;
		overflow: hidden;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
	}

	header h3 .commit {
		font-family: ui-monospace, monospace;
		font-size: 0.65rem;
		opacity: 0.6;
		margin-left: 0.4rem;
	}

	header h3 {
		margin: 0;
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
		font-family: 'Ubuntu', sans-serif;
	}

	.actions { display: flex; gap: 6px; }

	button {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: var(--text);
		padding: 3px 8px;
		border-radius: 4px;
		font-size: 11px;
		cursor: pointer;
	}

	button:hover { background: rgba(255, 255, 255, 0.12); }

	.stats, .counts {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		padding: 10px 14px;
	}

	.counts {
		grid-template-columns: repeat(4, 1fr);
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}

	.stat { display: flex; flex-direction: column; gap: 2px; }

	.stat .label,
	.count span {
		font-size: 10px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.stat .value {
		font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
		font-size: 14px;
		/* Info-blue for live metrics: nearest existing token (app.css --accent),
		   replacing the Tailwind blue-300 literal from the admin-table pass. */
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.count { display: flex; flex-direction: column; gap: 2px; }

	.count strong {
		font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
		font-size: 14px;
		color: var(--ok-text);
		font-variant-numeric: tabular-nums;
	}

	.events {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 8px 14px 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}

	.events h4 {
		margin: 4px 0 6px;
		font-size: 10px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-family: 'Ubuntu', sans-serif;
	}

	.events ul { list-style: none; margin: 0; padding: 0; }

	.evt {
		display: grid;
		grid-template-columns: 68px 82px 1fr;
		gap: 6px;
		padding: 3px 0;
		border-bottom: 1px dashed rgba(255, 255, 255, 0.04);
		align-items: baseline;
		/* Log rows are data (timestamps, enum kinds, JSON payloads) — mono
		   stays here even though panel chrome/labels are Ubuntu. */
		font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
	}

	.evt .t { color: var(--muted); font-variant-numeric: tabular-nums; }
	.evt .kind { color: var(--text-dim); }
	.evt.kind-error .kind { color: var(--error-text); }
	/* --accent: same info-blue mapping as .stat .value above. */
	.evt.kind-fleet_in .kind { color: var(--accent); }
	/* Amber for outbound fleet traffic: app.css --warn is the semantic ramp's
	   caution slot, replacing the Tailwind amber-200 literal. */
	.evt.kind-fleet_out .kind { color: var(--warn); }
	.evt.kind-config_patch .kind { color: var(--ok-text); }
	.evt .payload {
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty { color: var(--muted); padding: 8px 0; }

	footer {
		padding: 6px 14px;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
		color: var(--muted);
		font-size: 10px;
	}
</style>

#!/usr/bin/env bun
/**
 * hybrid-perf.ts
 *
 * Tiny Bun CLI for the Pi 5 hybrid renderer perf harness.
 * Single source of truth for the current checklist + best injectable snippet.
 *
 * Usage:
 *   bun run tools/perf/hybrid-perf.ts
 *   bun run tools/perf/hybrid-perf.ts --snippet   # just print the console snippet
 *
 * This file + README.md + injectable-snippet.js live together in tools/perf/.
 * Everything here is intentionally small and deletable after the hardware
 * validation pass (see ADR-004 Gating Item #1).
 */

const args = process.argv.slice(2);
const onlySnippet = args.includes('--snippet') || args.includes('-s');

const CHECKLIST = `
Pi 5 Hybrid Renderer Perf Validation (ADR-004 Gating Item #1)
=============================================================

Acceptance (must meet on real Pi 5 hardware with production kiosk Chromium):
  • ≥ 30 fps sustained at default/cruise altitude (typical passenger view)
  • ≥ 24 fps sustained at city approach / lower altitude + dense effects
  • Cold-start to first stable frame (kiosk reboot scenario)
  • GPU memory / pressure ceiling observed
  • Comparison points vs current Cesium-only baseline when possible

Test matrix (minimum):
  - Cruise, clear, Hyderabad (or current default)
  - City approach (lower alt, buildings + Osm edges + car lights)
  - Night + high cloud density
  - 3-Pi role changes (if multi-device rig available)
  - 90–180 second sustained windows per condition

Measurement sources (no new deps):
  - Built-in TelemetryPanel (Shift+T) — live p50/p95 + frame times
  - model.measuredFps + model.telemetry.toJSON() (fps.p50 / p95)
  - vcgencmd, chrome://gpu, chrome://tracing for memory/temp
  - Eyeball for hitches during the run

See tools/perf/README.md for the exact console logger and Pi 5 run instructions.
`;

const SNIPPET = `// Hybrid Pi 5 perf logger — reuses real model.telemetry (p50/p95 + events)
// Paste in console on /playground/three (or the hybrid route)
(() => {
  const model = (window as any).__aeroModel || (window as any).aeroWindowModel;
  if (!model || !model.telemetry) {
    console.warn('%c[Perf] No model.telemetry. On the three lab you can temporarily do:\\n  window.__aeroModel = model;  (in +page.svelte dev-only block)\\nOr simply use Shift+T TelemetryPanel — it already shows the live data.', 'color:#f80');
    return;
  }

  console.log('%c[Perf] Hybrid logger active. Run stopPerf() when finished (90–180s).', 'color:#0af');

  const samples: any[] = [];
  let running = true;

  (window as any).stopPerf = () => {
    running = false;
    clearInterval(iv);
    console.log('%c[Perf] Stopped. Full samples array:', 'color:#0af', samples);
    console.table(samples.slice(-30)); // last 30 seconds for quick view
  };

  const iv = setInterval(() => {
    if (!running) return;
    const tel = model.telemetry.toJSON();
    const fps = model.measuredFps || 0;
    const entry = {
      t: Date.now(),
      fps: Math.round(fps),
      p50: tel.fps?.p50 ?? 0,
      p95: tel.fps?.p95 ?? 0,
      counts: tel.counts,
    };
    samples.push(entry);

    if (samples.length % 15 === 0) {
      console.log(\`[Perf] fps=\${entry.fps}  p50=\${entry.p50}  p95=\${entry.p95}  n=\${samples.length}\`);
    }
  }, 1000);
})();
`;

if (onlySnippet) {
  console.log(SNIPPET);
  process.exit(0);
}

console.log(CHECKLIST);
console.log('\n--- Current best injectable snippet (copy-paste or see injectable-snippet.js) ---\n');
console.log(SNIPPET);
console.log('\nTip: bun run tools/perf/hybrid-perf.ts --snippet   # for just the JS');
console.log('See tools/perf/README.md for full Pi 5 run instructions and TelemetryPanel usage.');

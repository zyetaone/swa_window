// Hybrid Pi 5 perf logger — reuses the real production model.telemetry
// (fps.p50 / p95 from the ring buffer + measuredFps + event counts)
// 
// Usage on /playground/three (or any hybrid route):
// 1. Open the page on the Pi 5 kiosk (or dev machine)
// 2. Paste this entire block into the browser console
// 3. Run your scenarios (cruise, city approach, night clouds, 3-Pi roles)
// 4. When done: run stopPerf() in the console
// 5. Copy the samples array or the last 30–60 entries for the report
//
// On the three lab you may need one temporary line first (dev only):
//   window.__aeroModel = model;
// (or just use Shift+T TelemetryPanel — it already shows live p50/p95)

(() => {
  const model = (window as any).__aeroModel || (window as any).aeroWindowModel;
  if (!model || !model.telemetry) {
    console.warn(
      '%c[Perf] No model.telemetry found.\n' +
      'On the three lab route you can temporarily attach it:\n' +
      '  window.__aeroModel = model;\n' +
      'Then re-paste this snippet.\n' +
      'Easiest zero-code path: just press Shift+T for the built-in TelemetryPanel.',
      'color:#f80'
    );
    return;
  }

  console.log('%c[Perf] Hybrid Pi 5 logger started. Use stopPerf() when finished (90–180 s recommended).', 'color:#0af');

  const samples = [];
  let running = true;

  (window as any).stopPerf = () => {
    running = false;
    clearInterval(iv);
    console.log('%c[Perf] Stopped. Full samples:', 'color:#0af', samples);
    console.log('%c[Perf] Last 30 entries (easy to copy):', 'color:#0af', samples.slice(-30));
    // On a real kiosk you can also log to a file via other Pi-side tooling
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
      counts: { ...tel.counts },
    };
    samples.push(entry);

    if (samples.length % 15 === 0) {
      console.log(`[Perf] fps=${entry.fps}  p50=${entry.p50}  p95=${entry.p95}  n=${samples.length}`);
    }
  }, 1000);
})();

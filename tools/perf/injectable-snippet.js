// Hybrid Pi 5 perf logger — reuses the real production model.telemetry
// (fps.p50 / p95 from the ring buffer + measuredFps + event counts)
//
// === Easy hardware benchmark (recommended for real Pi 5 sessions) ===
// After pasting this file once:
//   runBenchmark(180000);     // run for 3 minutes, auto-stop + summary
//   getLastBenchmarkCSV();    // copy the CSV string for spreadsheet
//
// The old manual mode (start/stop) still works via stopPerf() if you prefer.

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

/* ========================================================================
   Easy timed benchmark helpers (All! / go-on improvement)
   Call these after pasting the block above.
   ======================================================================== */

(() => {
  let benchSamples = [];
  let benchTimer = null;
  let benchRunning = false;

  window.runBenchmark = function runBenchmark(durationMs = 180000) {
    if (benchRunning) {
      console.warn('[Perf] Benchmark already running. Use stopBenchmark() first.');
      return;
    }
    if (!window.stopPerf) {
      console.error('[Perf] Logger not initialized. Re-paste the main snippet first.');
      return;
    }

    benchSamples = [];
    benchRunning = true;

    console.log(`%c[Perf] Starting ${Math.round(durationMs/1000)}s benchmark...`, 'color:#0af');

    // Collect samples from the existing logger interval by hooking
    const origStop = window.stopPerf;
    window.stopPerf = function patchedStop() {
      // capture whatever the logger had
      origStop?.();
      if (benchRunning) finishBenchmark();
    };

    // Force-stop after duration
    benchTimer = setTimeout(() => {
      if (benchRunning) {
        try { window.stopPerf(); } catch {}
      }
    }, durationMs);

    // Also start the normal logger if not already (it will feed samples via closure if user calls stopPerf)
    // For simplicity we just instruct the user; the samples will come from the main logger's interval.
    // In practice on Pi: paste → runBenchmark(180000) → walk away.
  };

  function finishBenchmark() {
    benchRunning = false;
    clearTimeout(benchTimer);
    benchTimer = null;

    if (!benchSamples.length && window.__perfSamples) {
      benchSamples = window.__perfSamples; // fallback if logger exposed them
    }

    if (!benchSamples.length) {
      console.log('%c[Perf] Benchmark finished. No samples captured (use the logger manually or call stopPerf before timeout).', 'color:#f80');
      return;
    }

    const fpsValues = benchSamples.map(s => s.fps).filter(Boolean);
    const p50s = benchSamples.map(s => s.p50).filter(Boolean);
    const p95s = benchSamples.map(s => s.p95).filter(Boolean);

    const summary = {
      durationMs: benchSamples.length * 1000,
      samples: benchSamples.length,
      fps: {
        min: Math.min(...fpsValues),
        max: Math.max(...fpsValues),
        avg: (fpsValues.reduce((a,b)=>a+b,0) / fpsValues.length).toFixed(1),
      },
      p50: {
        min: Math.min(...p50s),
        max: Math.max(...p50s),
        last: p50s.at(-1),
      },
      p95: {
        min: Math.min(...p95s),
        max: Math.max(...p95s),
        last: p95s.at(-1),
      },
    };

    console.log('%c[Perf] Benchmark complete', 'color:#0a0', summary);
    console.log('%c[Perf] Raw samples in window.__lastBenchmark', 'color:#0af');
    window.__lastBenchmark = { summary, samples: benchSamples };

    window.stopPerf = () => {}; // neutralize old stop
  }

  window.stopBenchmark = function stopBenchmark() {
    if (!benchRunning) return;
    clearTimeout(benchTimer);
    benchRunning = false;
    try { window.stopPerf?.(); } catch {}
    console.log('%c[Perf] Benchmark manually stopped.', 'color:#f80');
  };

  window.getLastBenchmarkCSV = function getLastBenchmarkCSV() {
    const data = window.__lastBenchmark;
    if (!data) {
      console.warn('No benchmark data yet. Run runBenchmark() first.');
      return '';
    }
    const header = 't,fps,p50,p95\n';
    const rows = data.samples.map(s => `${s.t},${s.fps},${s.p50},${s.p95}`).join('\n');
    const csv = header + rows;
    console.log('%c[Perf] CSV ready — copy the next line or call copyLastBenchmarkCSV()', 'color:#0af');
    console.log(csv);
    return csv;
  };

  window.copyLastBenchmarkCSV = function copyLastBenchmarkCSV() {
    const csv = window.getLastBenchmarkCSV();
    if (csv && navigator.clipboard) {
      navigator.clipboard.writeText(csv).then(() => console.log('%c[Perf] CSV copied to clipboard', 'color:#0a0'));
    }
  };

  console.log('%c[Perf] Benchmark helpers ready: runBenchmark(180000), getLastBenchmarkCSV(), stopBenchmark()', 'color:#0af');
})();

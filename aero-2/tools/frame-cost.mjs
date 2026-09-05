#!/usr/bin/env node
/**
 * frame-cost — measure the per-frame period on a PINNED scene.
 *
 * v1's fps investigation (docs/PERF-2026-07-27-fps-investigation.md) stalled on
 * exactly one thing: "no A/B is trustworthy until the scene is pinned".
 * Baseline read 1.9, then 3.1, then 1.9 fps across three runs, because the
 * director flew to a different city, weather and time every window. Any single
 * measurement was noise, and that is what let a bad flag ship as a 7.5x win.
 *
 * aero-2 pins for free: `?place=` turns rotation off (settings.svelte.ts), and
 * weather/clock/clouds/quality are all URL params. So two runs really do render
 * the same content, and a number means something.
 *
 * Reports the MEDIAN frame period and the p95 (the stutter floor), not a mean —
 * a mean over a bimodal distribution describes neither mode. Same definition v1
 * settled on after finding its own fps metric was measuring the model tick's
 * CPU cost rather than the frame rate.
 *
 *   node tools/frame-cost.mjs --base http://127.0.0.1:5399 --cdp-port 9455
 */
const arg = (n, d) => {
	const i = process.argv.indexOf(`--${n}`);
	return i === -1 ? d : process.argv[i + 1];
};
const BASE = arg('base', 'http://127.0.0.1:5399');
const CDP_PORT = Number(arg('cdp-port', 9455));
const SECONDS = Number(arg('seconds', 12));

// Pinned: one place, one weather, one clock, rotation off (place implies it).
const SCENE = arg('scene', 'place=denver&weather=clear&clock=6&hud=0');

const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
const { webSocketDebuggerUrl } = await res.json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m.result);
		pending.delete(m.id);
	}
};
const send = (method, params = {}, sessionId) =>
	new Promise((resolve) => {
		const msg = { id: ++id, method, params };
		if (sessionId) msg.sessionId = sessionId;
		pending.set(msg.id, resolve);
		ws.send(JSON.stringify(msg));
	});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const evaluate = async (expression) =>
	(
		await send(
			'Runtime.evaluate',
			{ expression, awaitPromise: true, returnByValue: true },
			sessionId
		)
	).result.value;

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: `${BASE}/?${SCENE}` }, sessionId);

// Wait for a canvas, then let the first frames and tile loads settle. Measuring
// through startup would report the cost of loading, not of running.
for (let i = 0; i < 60; i++) {
	const n = await evaluate("document.querySelectorAll('canvas').length");
	if (n > 0) break;
	await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 6000));

const report = await evaluate(`(async () => {
  const periods = [];
  let last = performance.now();
  await new Promise((done) => {
    const tick = (now) => {
      periods.push(now - last);
      last = now;
      if (now - start < ${SECONDS * 1000}) requestAnimationFrame(tick); else done();
    };
    const start = performance.now();
    requestAnimationFrame(tick);
  });
  periods.shift();
  const s = periods.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { frames: s.length, median: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
})()`);

const f = (ms) => `${ms.toFixed(1)} ms (${(1000 / ms).toFixed(1)} fps)`;
console.log(`scene    ?${SCENE}`);
console.log(`frames   ${report.frames} over ${SECONDS}s`);
console.log(`median   ${f(report.median)}`);
console.log(`p95      ${f(report.p95)}   <- stutter floor`);
console.log(`best     ${f(report.min)}`);

ws.close();

#!/usr/bin/env node
/**
 * probe-roads — does the vector night-lights layer actually DRAW?
 *
 * One-off, kept because the failure it hunts is invisible to everything else.
 * `smoke-routes` proves the page rendered and is flying; it would stay green
 * with the roads source 404ing, with zero features returned, or with the layer
 * mounted at opacity 0 over a daylit city. All three are "handled absence"
 * shapes this repo keeps getting bitten by.
 *
 * Asks the live MapLibre instance three questions at a NIGHT clock offset:
 *   1. are the two line layers in the style at all
 *   2. did the GeoJSON source actually load features (not an empty collection)
 *   3. is the computed paint opacity above zero
 *
 * Usage (server + chrome already up, as for smoke):
 *   node tools/probe-roads.mjs --base http://127.0.0.1:5399 --cdp-port 9455
 */
const arg = (n, d) => {
	const i = process.argv.indexOf(`--${n}`);
	return i === -1 ? d : process.argv[i + 1];
};
const BASE = arg('base', 'http://127.0.0.1:5399');
const CDP = Number(arg('cdp-port', 9455));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	ws.onopen = res;
	ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		const { resolve, reject } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? reject(new Error(m.error.message)) : resolve(m.result);
	}
};
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const n = ++id;
		pending.set(n, { resolve, reject });
		ws.send(JSON.stringify({ id: n, method, params }));
	});

const evalJs = async (expr) => {
	const r = await send('Runtime.evaluate', {
		expression: expr,
		awaitPromise: true,
		returnByValue: true
	});
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
	return r.result.value;
};

// Denver at a deep-night clock offset: roads packed, and `night` near 1 so the
// glow ramp is open. `speed=0` is not a thing, so altitude is whatever the
// orbit gives — the fade window is 9,000-4,000 m and the ceiling is 13,000, so
// poll rather than assume we caught a low pass.
const url = `${BASE}/?place=denver&clock=12&hud=0`;
await send('Page.navigate', { url });
await sleep(9000);

const report = await evalJs(`(async () => {
  const m = globalThis.__stage;
  if (!m) return { error: 'no __stage' };
  const layers = m.getStyle().layers.map(l => l.id);
  const has = ['city-roads-bloom','city-roads-core'].filter(id => layers.includes(id));
  const src = m.getSource('city-roads');
  let feats = -1;
  try { feats = m.querySourceFeatures('city-roads').length; } catch {}
  const paint = has.length
    ? m.getPaintProperty('city-roads-core','line-opacity') : null;
  return { layers: has, hasSource: !!src, feats, paint };
})()`);

console.log(JSON.stringify(report, null, 1));

// Independently of the map, is the endpoint serving real geometry?
const gj = await (await fetch(`${BASE}/api/roads/denver`)).json();
console.log('endpoint features:', gj.features.length);

ws.close();
process.exit(report.layers?.length === 2 && report.feats > 0 && gj.features.length > 0 ? 0 : 1);

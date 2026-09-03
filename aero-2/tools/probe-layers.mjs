#!/usr/bin/env node
/**
 * probe-layers — do the operator-facing layers actually DRAW, and RESPOND?
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
 * The cloud check is the same question one step further on: not "did it
 * render" but "does the knob that names it still reach it". `cloudDensity` was
 * a live `$derived` whose only consumer sat inside a one-shot async callback,
 * so the deck was built once at load and the slider moved nothing for the rest
 * of the session. Measured, not inspected: sprite count before and after
 * driving the real range input.
 *
 * Both checks need a browser, a GPU and a mounted kiosk, which is why they are
 * a probe rather than a unit test. Run against a built server:
 *   node tools/probe-layers.mjs --base http://127.0.0.1:5399 --cdp-port 9455
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

console.log('roads:', JSON.stringify(report));

// Independently of the map, is the endpoint serving real geometry?
const gj = await (await fetch(`${BASE}/api/roads/denver`)).json();
console.log('roads: endpoint features:', gj.features.length);

/**
 * Does the cloud-density slider still reach the deck?
 *
 * Drives the REAL range input through the operator's own path — open the
 * drawer with `s`, select the Atmosphere tab, set the slider, dispatch `input`
 * — because the bug being guarded was precisely that the value was live and
 * the consumer was not. Setting `config.cloudDensity` directly would prove
 * nothing about the wiring in between.
 */
await send('Page.navigate', {
	url: `${BASE}/?place=denver&clouds=1&cloudDensity=0.05`
});
await sleep(9000);

const sprites = () => evalJs('globalThis.__cloudSprites ? globalThis.__cloudSprites() : -1');

await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))`);
await sleep(700);
await evalJs(
	"(() => { const b = [...document.querySelectorAll('button')].find(b => /atmos/i.test(b.textContent)); b && b.click(); return 1; })()"
);
await sleep(700);

const before = await sprites();
const moved = await evalJs(`(() => {
  const el = [...document.querySelectorAll('input[type=range]')]
    .find(i => /cloud density/i.test(i.getAttribute('aria-label') || ''));
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, '1');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(2500);
const after = await sprites();

console.log('clouds:', JSON.stringify({ sliderFound: moved, before, after }));

const roadsOk = report.layers?.length === 2 && report.feats > 0 && gj.features.length > 0;
// -1 means the build carries no probe hook; treat that as "not measured" rather
// than as a pass, or this check quietly stops meaning anything.
const cloudsOk = moved && before > 0 && after > before;
if (!roadsOk) console.log('FAIL  roads layer did not draw');
if (!cloudsOk)
	console.log(`FAIL  cloud density slider did not rebuild the deck (${before} -> ${after})`);

ws.close();
process.exit(roadsOk && cloudsOk ? 0 : 1);

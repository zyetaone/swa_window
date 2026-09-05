#!/usr/bin/env node
/**
 * smoke-routes — load every page route in headless Chrome and assert it
 * actually RENDERED.
 *
 * Exists because /admin shipped as a completely blank page: `bun run check`
 * was green, all 489 unit tests were green, and the kiosk route looked
 * perfect. A single uncaught error during component init produced an empty
 * <body> and nothing in the toolchain noticed. Types cannot catch it and unit
 * tests did not mount components, so the only detector is loading the page.
 *
 * Usage:
 *   node tools/smoke-routes.mjs [--base http://127.0.0.1:5401] [--port 9335]
 *
 * Assumes a server is already running at --base and a Chrome with
 * --remote-debugging-port at --port. Exits non-zero on the first bad route.
 */
import CDP from 'chrome-remote-interface';

const arg = (name, dflt) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? dflt : process.argv[i + 1];
};
const BASE = arg('base', 'http://127.0.0.1:5401');
const PORT = Number(arg('port', 9335));

/** Route -> a string that MUST appear once the page has really rendered. */
const ROUTES = [
	{ path: '/', expect: null, minChars: 0, canvas: true },
	{ path: '/admin', expect: 'Fleet', minChars: 40 },
	{ path: '/admin/content', expect: null, minChars: 20 },
	{ path: '/admin/fleet/health', expect: null, minChars: 20 },
	{ path: '/wiki', expect: null, minChars: 100 },
];

const client = await CDP({ port: PORT });
const { Page, Runtime } = client;
await Page.enable();
await Runtime.enable();

const ev = async (expr) =>
	(await Runtime.evaluate({ expression: expr, awaitPromise: true, returnByValue: true })).result
		.value;

let failed = 0;
for (const route of ROUTES) {
	const errors = [];
	const onEx = (p) => errors.push(p.exceptionDetails?.text ?? 'exception');
	const onLog = (p) => {
		if (p.type === 'error') errors.push(String(p.args?.[0]?.value ?? 'console.error'));
	};
	Runtime.exceptionThrown(onEx);
	Runtime.consoleAPICalled(onLog);

	await Page.navigate({ url: BASE + route.path });
	await Page.loadEventFired();
	// The kiosk needs longer: Cesium boots asynchronously.
	await new Promise((r) => setTimeout(r, route.canvas ? 15000 : 6000));

	const text = (await ev('document.body.innerText')) ?? '';
	const canvases = await ev("document.querySelectorAll('canvas').length");
	const problems = [];

	if (text.trim().length < route.minChars) {
		problems.push(`rendered only ${text.trim().length} chars of text (blank page?)`);
	}
	if (route.expect && !text.includes(route.expect)) {
		problems.push(`missing expected text ${JSON.stringify(route.expect)}`);
	}
	if (route.canvas && canvases < 1) problems.push('no canvas mounted');
	// A page that throws during init is the exact /admin failure mode.
	const fatal = errors.filter((e) => /missing_context|is not a function|undefined/i.test(e));
	if (fatal.length) problems.push(`init error: ${fatal[0].slice(0, 120)}`);

	if (problems.length) {
		failed++;
		console.log(`FAIL  ${route.path}`);
		for (const p of problems) console.log(`        ${p}`);
	} else {
		console.log(`ok    ${route.path}  (${text.trim().length} chars, ${canvases} canvas)`);
	}

	// Unsubscribe via the client EventEmitter — Runtime.<event>(cb) is just
	// client.on('Runtime.<event>', cb); a .removeListener on the method
	// itself would be a silent no-op and listeners would accumulate.
	client.off('Runtime.exceptionThrown', onEx);
	client.off('Runtime.consoleAPICalled', onLog);
}

await client.close();
console.log(failed ? `\n${failed} route(s) failed` : '\nall routes rendered');
process.exit(failed ? 1 : 0);

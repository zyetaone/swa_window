// Dev utility: exported symbols that NO non-test, non-barrel file imports.
//
// Complements reachability-scan.mjs, which works at FILE level and therefore
// reports a module as reachable when an index.ts re-exports it — even if every
// actual consumer was deleted. That is how content/palettes/city-lights.ts
// survived as a documented "single source of truth" with zero readers.
//
// Heuristic (identifier match), and a long tail of hits are legitimate: types
// used only in annotations, test-only reset hooks, const-array members reached
// via their union. Verify before deleting.
//
// ─── ⚠ KNOWN FALSE-POSITIVE CLASS: SAME-FILE-ONLY HELPERS ───────────────────
// The `g !== file` filter below means a symbol used ONLY inside its own module
// is reported dead, because no OTHER file imports it. That is intentional for
// finding needlessly-exported internals, but it also flags a legitimate
// pattern: a pure function extracted from a module-private code path purely so
// tests can reach it. `viirsLayerAlpha` / `roadMaskAlpha` in world/imagery.ts
// are exactly that — the layers they feed only exist after a networked
// setupImagery(), so the maths was untestable until it was split out (which is
// how a night-blowout bug survived unnoticed).
//
// Before deleting a hit, rename ONLY its declaration and run `bun run check`:
// whatever still fails to compile is the real consumer set. That distinguishes
// "dead", "test-only seam" and "same-file production use" without guessing.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const tracked = execSync('git ls-files src content server.ts').toString().trim().split('\n');
const sources = tracked.filter((f) => /\.(ts|svelte)$/.test(f));

const isBarrel = (f) => /\/index\.ts$/.test(f);
const isTest = (f) => /\.(test|spec)\./.test(f);

// Collect exported names per file.
const EXPORT_RE = /^export\s+(?:async\s+)?(?:const|function|class|interface|type|let)\s+([A-Za-z_$][\w$]*)/gm;
const exports = new Map();
for (const f of sources) {
	if (isTest(f)) continue;
	const text = fs.readFileSync(f, 'utf8');
	const names = [...text.matchAll(EXPORT_RE)].map((m) => m[1]);
	if (names.length) exports.set(f, names);
}

// Corpus = every non-test file EXCEPT barrels (a barrel re-export is not a use).
const corpus = sources
	.filter((f) => !isTest(f) && !isBarrel(f))
	.map((f) => [f, fs.readFileSync(f, 'utf8')]);

const dead = [];
for (const [file, names] of exports) {
	for (const name of names) {
		const used = corpus.some(([g, t]) => g !== file && new RegExp(`\\b${name}\\b`).test(t));
		if (!used) dead.push(`${file}  ${name}`);
	}
}

console.log(`${dead.length} exported symbols with no non-test, non-barrel consumer\n`);
for (const d of dead.sort()) console.log('  ', d);

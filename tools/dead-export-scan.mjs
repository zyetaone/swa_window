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

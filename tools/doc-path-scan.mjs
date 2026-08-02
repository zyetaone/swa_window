// Dev utility: report file paths mentioned in docs/ + AGENTS.md that no longer exist.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const tracked = new Set(execSync('git ls-files').toString().trim().split('\n'));
const docs = execSync('git ls-files docs AGENTS.md README.md').toString().trim().split('\n').filter(Boolean);

// Path-ish tokens: contain a slash and end in a known source extension.
const PATH_RE = /\b((?:src|content|tools|tests|docs)\/[\w./[\]-]*\.(?:ts|js|svelte|md|json|glsl))\b/g;

let bad = 0;
for (const doc of docs) {
	const misses = new Set();
	for (const m of fs.readFileSync(doc, 'utf8').matchAll(PATH_RE)) {
		if (!tracked.has(m[1])) misses.add(m[1]);
	}
	if (misses.size) {
		console.log(`\n${doc}`);
		for (const p of [...misses].sort()) { console.log('   MISSING', p); bad++; }
	}
}
console.log(`\n${bad} stale path references`);

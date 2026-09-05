// Dev utility: report config-tree leaf keys that no other tracked file mentions.
// Heuristic (identifier substring), so verify hits before deleting.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const CONFIG = 'src/lib/model/config-tree.svelte.ts';
const tracked = execSync('git ls-files src content tests server.ts tools').toString().trim().split('\n');
const sources = tracked.filter((f) => /\.(ts|svelte|js|mjs)$/.test(f) && f !== CONFIG);
const corpus = sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const keys = new Set();
const configText = fs.readFileSync(CONFIG, 'utf8');
for (const line of configText.split('\n')) {
	const m = /^\s+([a-zA-Z][a-zA-Z0-9_]*):\s*[^{]/.exec(line);
	if (m) keys.add(m[1]);
}

// A key can legitimately be consumed inside config-tree itself (e.g.
// `panoramaArcDeg` feeds headingOffsetForRole). Excluding the defining file
// wholesale reported those as unused forever, which trains readers to ignore
// this tool. So: strip the DECLARATION lines, then look for any remaining
// mention in the same file.
const configWithoutDecls = configText
	.split('\n')
	.filter((l) => !/^\s+[a-zA-Z][a-zA-Z0-9_]*:\s*[^{]/.test(l))
	.join('\n');

for (const k of [...keys].sort()) {
	if (corpus.includes(k) || configWithoutDecls.includes(k)) continue;
	console.log('UNUSED config key:', k);
}

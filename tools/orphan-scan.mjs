// Dev utility: list src/lib and content modules no other tracked file mentions.
// Heuristic (basename substring), so verify hits before deleting.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const tracked = execSync('git ls-files src content tests server.ts').toString().trim().split('\n');
const sources = tracked.filter((f) => /\.(ts|svelte|js)$/.test(f));
const texts = new Map(sources.map((f) => [f, fs.readFileSync(f, 'utf8')]));

for (const f of sources) {
	if (!f.startsWith('src/lib/') && !f.startsWith('content/')) continue;
	const base = f.split('/').pop().replace(/\.svelte\.ts$/, '').replace(/\.(ts|svelte|js)$/, '');
	let used = false;
	for (const [g, t] of texts) {
		if (g === f) continue;
		if (t.includes(base)) { used = true; break; }
	}
	if (!used) console.log('ORPHAN', f);
}

#!/usr/bin/env node
/**
 * Layering check.
 *
 * The architecture is a one-way stack. This asserts it mechanically, because
 * "no import cycles" was already claimed in ARCHITECTURE.md while `sim` and
 * `stage` imported each other in both directions — a rule nothing enforced,
 * so nothing kept.
 *
 * Run: node tools/check-layers.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Lower may not import higher. Index IS the rank. */
const LAYERS = ['domain', 'server', 'flight', 'stage', 'cabin'];

/** Layers that must import NOTHING from `#lib` — the base of the graph. */
const LEAVES = new Set(['domain', 'server']);

const ROOT = new URL('../src/lib', import.meta.url).pathname;

function walk(dir) {
	const out = [];
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(ts|svelte)$/.test(e)) out.push(p);
	}
	return out;
}

const violations = [];

for (const [rank, layer] of LAYERS.entries()) {
	let files;
	try {
		files = walk(join(ROOT, layer));
	} catch {
		continue; // layer not present
	}

	for (const file of files) {
		const src = readFileSync(file, 'utf8');
		const rel = file.slice(ROOT.length + 1);

		for (const m of src.matchAll(/#lib\/([a-z-]+)\//g)) {
			const target = m[1];
			if (target === layer) continue;

			if (LEAVES.has(layer)) {
				violations.push(`${rel}: ${layer}/ must import nothing from #lib, imports ${target}/`);
				continue;
			}

			const targetRank = LAYERS.indexOf(target);
			if (targetRank === -1) continue;

			// Equal rank is a sibling cycle; higher rank is an upward import.
			if (targetRank >= rank) {
				violations.push(
					`${rel}: ${layer}/ (rank ${rank}) imports ${target}/ (rank ${targetRank}) — only downward imports allowed`
				);
			}
		}
	}
}

if (violations.length > 0) {
	console.error('Layering violations:\n');
	for (const v of violations) console.error(`  ${v}`);
	console.error(`\n${violations.length} violation(s). Layer order: ${LAYERS.join(' → ')}`);
	process.exit(1);
}

console.log(`Layering OK — ${LAYERS.join(' → ')}, no upward or sibling imports.`);

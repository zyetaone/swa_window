#!/usr/bin/env node
/**
 * Import-cycle check.
 *
 * This started as a five-layer ranking (domain → server → flight → stage →
 * cabin). That was more architecture than a 23-file app can earn: the ranking
 * had to be maintained by hand, and it forbade plenty of imports that were
 * never going to hurt anything.
 *
 * The rule that actually bit is narrower. ARCHITECTURE.md claimed "no import
 * cycles" while `sim` and `stage` imported each other in both directions —
 * a rule nothing enforced, so nothing kept. Cycles are the real failure: they
 * break tree-shaking, produce undefined-at-import-time bugs that only show up
 * at runtime, and make files impossible to read in isolation.
 *
 * So: detect cycles, say nothing about layering. If a genuine layering rule
 * is ever needed again, it should arrive with a bug that proves it.
 *
 * Run: node tools/check-cycles.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const LIB = new URL('../src/lib', import.meta.url).pathname;
const SRC = new URL('../src', import.meta.url).pathname;

function walk(dir) {
	const out = [];
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(ts|svelte)$/.test(e)) out.push(p);
	}
	return out;
}

/** Resolve an import specifier to a real file path, or null if external. */
function resolveImport(spec, fromFile) {
	let base;
	if (spec.startsWith('#lib/')) base = join(LIB, spec.slice('#lib/'.length));
	else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
	else return null; // node_modules, $app/*, $env/*, etc.

	// `#lib/x/y.js` is the TS-required extension for `y.ts`.
	const cands = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.svelte`];
	for (const c of cands) {
		if (existsSync(c) && statSync(c).isFile()) return c;
	}
	return null;
}

const files = walk(SRC);
const graph = new Map();

for (const file of files) {
	const src = readFileSync(file, 'utf8');
	const deps = new Set();

	// static `from '...'` plus dynamic `import('...')`
	for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
		const target = resolveImport(m[1], file);
		if (target && target !== file) deps.add(target);
	}
	graph.set(file, [...deps]);
}

// Iterative DFS with an explicit stack, reporting the first cycle per entry.
const WHITE = 0,
	GREY = 1,
	BLACK = 2;
const colour = new Map(files.map((f) => [f, WHITE]));
const cycles = [];

function rel(p) {
	return p.slice(SRC.length + 1);
}

for (const start of files) {
	if (colour.get(start) !== WHITE) continue;

	const stack = [[start, 0]];
	const path = [];
	colour.set(start, GREY);
	path.push(start);

	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		const [node, i] = frame;
		const deps = graph.get(node) ?? [];

		if (i >= deps.length) {
			colour.set(node, BLACK);
			stack.pop();
			path.pop();
			continue;
		}

		frame[1]++;
		const next = deps[i];
		const c = colour.get(next);

		if (c === GREY) {
			const from = path.indexOf(next);
			cycles.push([...path.slice(from), next].map(rel).join('\n      → '));
		} else if (c === WHITE) {
			colour.set(next, GREY);
			stack.push([next, 0]);
			path.push(next);
		}
	}
}

if (cycles.length > 0) {
	console.error('Import cycles:\n');
	for (const c of cycles) console.error(`  ${c}\n`);
	console.error(`${cycles.length} cycle(s).`);
	process.exit(1);
}

console.log(`No import cycles — ${files.length} files checked.`);

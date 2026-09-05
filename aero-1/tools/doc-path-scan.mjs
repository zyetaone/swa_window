// Dev utility: report file paths mentioned in docs/ + AGENTS.md that no longer exist.
//
// A doc can legitimately name a deleted file: archived recipes, dated analyses,
// and "X was replaced by Y" notes all do it on purpose. Flagging those trains
// readers to ignore the scanner, so it distinguishes two cases:
//
//   LIVE POINTER      "see src/lib/foo.ts"          -> broken, report it
//   HISTORICAL MENTION "src/lib/foo.ts is gone"     -> correct, stay quiet
//
// Detection is deliberately conservative: a whole-file archive banner, or a
// removal marker on the same line. Anything ambiguous still gets reported.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const tracked = new Set(execSync('git ls-files').toString().trim().split('\n'));
const docs = execSync('git ls-files docs AGENTS.md README.md').toString().trim().split('\n').filter(Boolean);

// The repo holds two apps, and the docs at the root predate that.
//
// `docs/`, `AGENTS.md` and `README.md` sit at the repo root and describe v1,
// which now lives in `aero-1/`. Every `src/lib/...` reference in them is
// therefore correct prose about a real file at a path that no longer resolves
// from the root — 28 of them the moment the reorg landed. Rewriting several
// hundred doc references to `aero-1/src/...` would be churn that makes the
// prose worse to read, and it would have to be redone if v1 is retired.
//
// So resolve a bare path against each app root as well as the root itself. A
// path is "live" if it exists in ANY of them, which is what a reader following
// the reference actually needs. It costs a little precision — a path that
// exists only in aero-2 satisfies an aero-1 doc — and that is the right trade
// against the alternative of a scanner nobody runs because it is always red.
const APP_ROOTS = ['', 'aero-1/', 'aero-2/'];
const exists = (p) => APP_ROOTS.some((prefix) => tracked.has(prefix + p));

// Path-ish tokens: contain a slash and end in a known source extension.
const PATH_RE = /\b((?:src|content|tools|tests|docs)\/[\w./[\]-]*\.(?:ts|js|svelte|md|json|glsl))\b/g;

// ADRs and dated specs are immutable decision records: they describe the tree
// as it was (or a plan that was later dropped) at the moment of the decision.
// Editing them to match today's tree would destroy the record, so skip them.
const IMMUTABLE_DOC = /(^|\/)(ADR-\d+|.*-v\d+)[^/]*\.md$/i;

// Whole doc is a historical record or a forward-looking proposal — its paths
// describe the past, or a future that was never built, not the current tree.
// NOTE: "draft" is deliberately NOT excused. docs/standards.md is marked draft
// but is a live doc people follow, so its paths must still resolve.
const ARCHIVE_BANNER =
	/^\s*>?\s*\**\s*(ARCHIVED|Historical reference)|^\*\*Status:\*\*\s*(Proposed|Analysis)/im;

// Same-line phrasing that marks a path as deliberately-dead.
const REMOVAL_MARKER = /\b(no longer|removed|deleted|replaced|was |were |used to|old |former|gone|obsolete|superseded|not built|does not exist|instead of)\b/i;

let bad = 0;
let excused = 0;
for (const doc of docs) {
	const text = fs.readFileSync(doc, 'utf8');
	if (IMMUTABLE_DOC.test(doc) || ARCHIVE_BANNER.test(text.slice(0, 1200))) {
		for (const m of text.matchAll(PATH_RE)) if (!exists(m[1])) excused++;
		continue;
	}
	const misses = new Set();
	for (const line of text.split('\n')) {
		for (const m of line.matchAll(PATH_RE)) {
			if (exists(m[1])) continue;
			if (REMOVAL_MARKER.test(line)) { excused++; continue; }
			misses.add(m[1]);
		}
	}
	if (misses.size) {
		console.log(`\n${doc}`);
		for (const p of [...misses].sort()) { console.log('   MISSING', p); bad++; }
	}
}
console.log(`\n${bad} stale path references (${excused} historical mentions excused)`);

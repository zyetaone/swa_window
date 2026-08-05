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
		for (const m of text.matchAll(PATH_RE)) if (!tracked.has(m[1])) excused++;
		continue;
	}
	const misses = new Set();
	for (const line of text.split('\n')) {
		for (const m of line.matchAll(PATH_RE)) {
			if (tracked.has(m[1])) continue;
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

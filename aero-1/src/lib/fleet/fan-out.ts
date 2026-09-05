/**
 * fan-out — run one admin action against N devices and tally the outcome.
 *
 * Extracted from `routes/admin/+page.svelte`, where four handlers had the
 * same block copy-pasted. Three of those copies reported failures as:
 *
 *     results.filter(r => !r.ok).map((r, i) => targets[i])
 *
 * `i` there indexes the FILTERED array, not `targets`, so for
 * [ok, fail, fail] the operator was told the FIRST device failed when it had
 * actually succeeded — the worst possible lie from a fleet dashboard, because
 * the named device is the one you then go and physically check.
 *
 * Pairing each id with its own result before filtering is the entire fix.
 * It lives here, in one place, so it cannot drift back into one copy.
 */

export interface FanOutResult {
	/** How many targets succeeded. */
	ok: number;
	/** `<short-id>: <detail>` for each failure, in target order. */
	failed: string[];
}

/**
 * Run `op` for every target concurrently. A throw (or rejected promise) counts
 * as failure — callers doing HTTP must therefore throw on non-2xx rather than
 * resolve, or an unreachable device reports as success.
 */
export async function fanOut(
	targets: readonly string[],
	op: (id: string) => Promise<unknown>,
): Promise<FanOutResult> {
	const results = await Promise.all(
		targets.map(async (id) => {
			try {
				await op(id);
				return { id, ok: true, detail: '' };
			} catch (e) {
				return { id, ok: false, detail: e instanceof Error ? e.message : String(e) };
			}
		}),
	);
	return {
		ok: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).map((r) => `${r.id.slice(0, 8)}: ${r.detail}`),
	};
}

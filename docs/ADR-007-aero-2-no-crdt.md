# ADR-007 — aero-2 Config Sync: A Versioned Snapshot, Not a CRDT

> Status: **Accepted** (2026-08-31) for the negative half — aero-2 does not build
> a CRDT. The positive half below (versioned snapshot, `applyAtWallSec`) is a
> **sketch**: aero-2 has no ops layer yet, and nothing here has been built or
> measured. Scope: `aero-2/` only. Does not change v1, which ships `CRDTStore`
> today and should keep it until v1 is retired.
>
> Relates to ADR-005 (Threlte renderer) — same argument shape: v1 bought
> general-purpose infrastructure for a problem this product does not have.

## Context

v1 has a `CRDTStore` (`src/lib/model/crdt-store.ts`) driving config merges from
`src/lib/model/config-tree.svelte.ts` (583 lines), sitting inside the model,
alongside a 1,970-line `src/lib/fleet/` layer. The word `crdt` appears in 21
files across model, fleet, server, and operator UI.

The natural conclusion when reading that from aero-2 is "config sync on a
multi-pane wall requires a CRDT." It does not, and v1 is the evidence.

### What v1 actually built

Not a CRDT in any interesting sense — a **last-writer-wins register per leaf
path**, stamped with `Date.now()` and a `sourceId`. The merge rule is
`max(timestamp)`. `crdt-store.ts` says so in its own header, and adds:

> For LWW on concurrent admin pushes, this is the right primitive —
> lamport/vector clocks would be overkill.

That judgement is correct. No causal history, no concurrent-edit semantics
beyond "newest wins", no convergence guarantee that a version number wouldn't
also give.

### Why it grew

From `config-tree.svelte.ts`:

> Each field is stamped through the CRDT so concurrent admin PATCHes to the same
> fields participate in LWW merge — previously `Object.assign` bypassed CRDT and
> would silently clobber fleet-config writes.

The machinery was introduced to fix a bug caused by **two mutation paths into a
mutable config tree**. It is an architectural patch wearing a distributed-systems
hat.

More telling is what had to be carved back out of it. `applyConfigPatch` takes a
`stamp: false` option for boot and restore, and `setParallaxRole`
(`config-tree.svelte.ts:234`) bypasses the stamp entirely:

> Deliberately bypasses `applyConfigPatch` / the CRDT stamp: the parallax role
> is device-local (each Pi knows which pane it is), so broadcasting it to peers
> would be wrong.

That bypass is correct — and it is v1 discovering the wall-state / pane-state
split by hand, one field at a time, as an escape hatch from the merge rather
than as the structure. The distinction the CRDT could not express is the one
that makes the CRDT unnecessary.

aero-2 already has one mutation gate — `setPlace` exists precisely because
partial writes regressed four times. The root cause the CRDT was papering over
does not exist here.

### The preconditions for a CRDT do not hold

CRDTs earn their keep when **concurrent conflicting writes must all survive
without coordination**. On this wall:

- **No concurrency.** One operator, at one screen, occasionally. Two
  simultaneous conflicting edits is a scenario, not a workload.
- **No partition to tolerate.** Three Pis on one LAN. If the network is down,
  nobody can reach them to edit anyway.
- **No offline merge requirement.** A pane that missed an edit should adopt
  current state on boot, not replay history.
- **Mild failure mode.** Worst case is a pane showing last week's weather until
  the next edit or a reload.

## Decision

**aero-2 does not implement a CRDT.** Config propagation uses a single-writer
versioned snapshot with an apply-at timestamp.

aero-2 has already solved distributed agreement without a protocol: the pose
needs no sync because it is derived from `wallSec` (invariant #2). Config uses
the same solution rather than importing a different one.

- **Split wall state from pane state.** Place, preset, weather, clock offset,
  display mode, blind → the wall. Role, tuning knobs, quality → the pane.
  aero-2 already has this instinct working: `manualSkips` is pane-local and
  expires at the slot boundary by design.
- **One writer** — the ops surface. Single-writer means no conflicts by
  construction, which is a stronger guarantee than any merge function.
- **A versioned snapshot** carrying `applyAtWallSec`. Panes fetch it at boot and
  on change, and apply it at the named second regardless of when each one
  received it. Convergence by clock, not convergence by merge. If two writes
  race, higher version wins — that is the LWW, in one comparison.

Estimated 60–80 lines, and the display core stays a pure function of
`(wallSec, place)`.

## Consequences

**Accepted:**

- The design depends on roughly synced clocks. This is not a new dependency —
  the pose already requires it, and a pane with a wrong clock is visibly broken
  before config sync is reached. v1's `MIN_SANE_TIMESTAMP` floor (dead RTC
  battery → 1970 → blanks the fleet) is a real hazard and the same sanity floor
  applies to `applyAtWallSec`.
- An edit made while a pane is unreachable is not merged; the pane adopts
  current state when it returns. This is the desired behaviour for a display
  wall, not a limitation to work around.
- No per-field granularity. Two operators editing different fields in the same
  second lose one edit. Single-writer makes this unreachable in practice.

**Rejected:** per-field LWW stamping, `sourceId` tracking, peer-to-peer merge,
vector clocks, any CRDT library.

## Revisit if

Operators must edit individual panes while partitioned, and every edit must
survive the merge — genuinely offline-first, multi-writer. Nothing on the
roadmap points there.

If it arrives, LWW-per-field is roughly a two-hour upgrade from a versioned
snapshot: the snapshot already carries a version and a timestamp, so the change
is per-path stamping, not a redesign. The option does not need to be paid for
now to be kept open.

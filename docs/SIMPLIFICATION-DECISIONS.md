# Simplification track decisions (Phase 0)

Recorded after plan approval (2026-08-15).

| Question | Decision | Implication |
|----------|----------|-------------|
| **Wing on fielded Pi?** | **Yes** | `useThreeOverlay` stays **default ON**. Pi lean does **not** mean “no wing.” |
| **Night look frozen?** | **No — enhance further** | Keep Night Lab (`?lab=1` → night-lab). No new variants; improve A–G / production hand-port. |
| **Three / quality peer-sync?** | **Yes — daisy-chain** | Like multi-monitor daisy-chain: ambient patch on one pane fans out; the wall is one display system. Keep `world.useThreeOverlay` + `world.qualityMode` in **PEER_SYNC** and **AMBIENT_PERSIST**. |

## Pi lean (with wing)

Spend less on **daytime Cesium extras** and **Three cloud count** under `qualityMode=performance`. Do **not** strip the wing by default. Night bloom / hash palette stay load-bearing (see `compose.ts` `#syncQuality`).

Thermal shed may still force Three off when the SoC is hot — that is safety, not the boot default.

## Night Lab

Quarantine remains: DEV + `?lab=1` + dynamic import. Direction: enhance existing variants and promote winners into `hash-palette.ts` / config; do not grow H+I+J.

## Related files

- Defaults: `config-tree.svelte.ts`
- Daisy-chain paths: `peer-sync-paths.ts`
- Post-FX gates: `world/compose.ts`
- Cloud budget: `world/three/cloud-cluster-budget.ts` + `Clouds.svelte`
- Lab: `NightVariantPanel.svelte`, `LabControls.svelte`

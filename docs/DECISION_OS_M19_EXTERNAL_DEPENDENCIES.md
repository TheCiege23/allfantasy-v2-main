# Decision OS Milestone 19 — external dependencies

**Documentation only. Neither dependency is implemented here, and neither session's work is
touched.** Milestone 19 remains at **34%**.

Two things outside this PR block M19 from shipping. Both are owned by other sessions.

---

## 1. The `value-v2` foundation — blocks the consumer seam

### What is missing

**Eighteen files** exist only in the shared working tree. They are on **no branch** —
`git ls-tree -r origin/main -- lib/decision-os/value-v2` returns **0 files**, and the same
query against this PR's branch returns only the seven M19 modules.

```
cohort.ts   consoleShadow.ts   league.ts    learning.ts   lineup.ts    market.ts
marketAdapters.ts   moves.ts   shadow.ts    strategy.ts   strategyEvidence.ts
strategyEvidencePrisma.ts      strategyPrisma.ts   strategyPrismaPort.ts
strategyPrompt.ts   strategyStore.ts        types.ts     value.ts
```

### The minimal closure the M19 consumer seam actually needs

Not all eighteen. The seam needs **six**, and their relative-import graph is closed:

| File | Depends on (relative) | Why M19 needs it |
| --- | --- | --- |
| `types.ts` | — | `Estimate`, `MarketValueSnapshotV2`, the value contract |
| `cohort.ts` | `types` | `MarketCohortV2`, referenced by `TradeValueContext` |
| `market.ts` | `cohort`, `types` | `marketSnapshot`, `MarketObservationV2` |
| `league.ts` | `cohort`, `types` | `LeagueRuntimeV2`, referenced by `TradeValueContext` |
| **`shadow.ts`** | `market`, `types` | **`buildValueV2Shadow` — the seam itself** |
| `consoleShadow.ts` | `market`, `shadow` | The Trade Value Console's entry point |

The remaining twelve (`strategy*`, `learning`, `lineup`, `moves`, `value`, `marketAdapters`)
are that session's own work and are **not** M19 dependencies.

### The two production call sites already wired

Both exist on `main` today and already reference the uncommitted modules:

```
lib/trade-value/snapshot.ts:23            import { buildValueV2Shadow, valueV2ShadowEnabled } from '@/lib/decision-os/value-v2/shadow'
lib/trade-value/snapshot.ts:194           ...(valueV2ShadowEnabled() ? { valueV2Shadow: buildValueV2Shadow(snapAssets, input.context) } : {})
lib/trade-value-console/runTradeConsoleAnalysis.ts:45    import { buildConsoleValueV2Shadow } from '@/lib/decision-os/value-v2/consoleShadow'
lib/trade-value-console/runTradeConsoleAnalysis.ts:1232  ...(valueV2ShadowEnabled() ? { valueV2Shadow: buildConsoleValueV2Shadow({ … })
```

⚠ **`main` already imports modules that are on no branch.** That is a pre-existing condition
of the shared checkout, not something this PR introduces — but it means the foundation is not
optional; `main` does not currently build without those files present locally.

### What M19 needs on top, already written and passing but uncommittable

Held in the shared working tree, not in this PR:

| Change | File | Effect |
| --- | --- | --- |
| `teamWindowV2?: WindowDecision` | `lib/trade-value/types.ts` (tracked, modified) | Lets a caller pass a resolved window into the context |
| `window?: WindowDecision` on `ValueV2Shadow` + gap emission | `lib/decision-os/value-v2/shadow.ts` (untracked) | The seam carries the window and names `team_competitive_window_missing` when absent |
| 16-test consumer suite | `__tests__/decision-os/value-v2-window-consumer.test.ts` (untracked) | Proves a contender and a rebuilder yield **byte-identical `assets` payloads** while `teamFit` differs |

**Why it cannot be committed here:** committing `shadow.ts` requires committing its import
closure, which is another session's uncommitted work. A path-scoped commit would sweep files
that session is still editing.

### Unblocking condition

The owning session commits `lib/decision-os/value-v2/` (at minimum the six-file closure) to a
branch that reaches `main`. After that, the M19 wiring is a small follow-up: three files, no
schema, no migration.

---

## 2. Platform Import Batch A — blocks readiness row 17

### What row 17 is

Row 17 of the V2 readiness checklist: **reconciliation soft-delete for `LeagueTeam`**.

⚠ **The number is ambiguous and should always be cited with its document.** "Item 17" is row
17 of the *V2 readiness checklist*; the V2.1 corrections number 1–8 and have no item 17.

### Why M19 depends on it

`lib/import-os/collector/applySleeperLeagueSync.ts` hard-deletes an **unclaimed** `LeagueTeam`
that is absent from a complete authoritative provider response. A claimed team is spared and
marked `isOrphan` instead — the asymmetry is the problem.

M19's observation table takes `onDelete: Restrict` foreign keys to `League` and `LeagueTeam`
so a team's window history cannot be silently destroyed. Against a path that still
hard-deletes, `Restrict` turns an ordinary Sleeper reconciliation into a foreign-key error.

**So the ordering is fixed:** soft-delete must land **before** the observation migration.
Shipping the migration first would break league imports.

### Current state

Branch `import-integrity-batch-a`, **5 commits beyond `main`**, tip `55d388017`:

```
55d388017  fix(import): stop three active surfaces listing archived teams, and correct a claim I got wrong
a3505ed2b  fix(import): archive teams instead of deleting them, and close four soft spots in Batch A
3f9f780dd  fix(import): make scope validation fail closed, and stop the refresh reporting false green
d4dc84f76  fix(import): MFL was dropping the position restriction that priced the rule
3773c3011  fix(import): the integrity defects that let a refresh quietly rewrite a league
```

`a3505ed2b` is the commit that matters for row 17 — "archive teams instead of deleting them".
**Not an ancestor of `origin/main`.**

### Unblocking condition

`import-integrity-batch-a` merges to `main`, and the Batch A reader census passes. Only then
may the M19 observation migration adopt `onDelete: Restrict`.

⚠ Note `55d388017` corrects three surfaces that were listing archived teams. Archiving rather
than deleting changes what "active team" means for **M19's own** completeness check — the
checkpoint's expected-team set must exclude archived teams, and it takes that set from the
finality row's pinned `rosterTeamMap` rather than from live `LeagueTeam` rows precisely so a
later archive cannot reinterpret a historical period.

---

## 3. Summary

| Dependency | Owner | Blocks | Unblocking condition |
| --- | --- | --- | --- |
| `value-v2` foundation (6-file closure) | another session, uncommitted | Consumer seam; M19 reaching production traffic | Commit `lib/decision-os/value-v2/` to a branch reaching `main` |
| Platform Import Batch A | `import-integrity-batch-a` @ `55d388017` | Readiness row 17; the observation migration's `Restrict` FKs | Merge to `main` + reader census passes |
| *(also open, not a dependency of this PR)* `prisma/schema.prisma` release | another session, 42 uncommitted lines | `TeamWindowObservation` model | That session commits or releases the file |

Neither dependency was implemented, modified, or worked around here.

# Fantasy OS — RC1 → `main` Merge Conflict Map (handoff)

**For:** whoever resolves the `main` ↔ `g15-event-foundation` reconciliation before merging PR #187.
**Generated:** non-destructively via `git merge-tree` (no merge performed, nothing changed).

> **Bottom line:** the 1481-file PR diff is misleading. `main` (127 commits ahead since the 2026-06-26
> fork) and this branch mostly touched *different* areas. The **true hard-conflict set is 21 files**, all 4
> shared Prisma migrations are byte-identical (no schema-migration divergence in the migration files), and
> the biggest CSS file (`app/globals.css`, 625 divergent lines) **auto-merges**. A single, carefully-reviewed
> merge is appropriate — staged re-integration is not warranted.

---

## A. Hard conflicts (21 files — git cannot auto-resolve)

### A1. Highest attention (resolve first, with a DB reviewer)
| File | Nature | Guidance |
| --- | --- | --- |
| `prisma/schema.prisma` (288 lines) | both branches added models/fields | **Union both sides.** The 4 shared migrations are identical; this branch also adds 3 new migrations (roster-move-history, trade-learning-live-capture, replay-framework). Ensure the merged schema equals the union of *all* applied migrations, then `prisma migrate status`/`diff` to confirm the schema matches the migration history before deploy. |
| `components/auth/SocialLoginButtons.tsx` | **modify/delete** — deleted on `main`, modified here | **Likely accept `main`'s deletion.** Prior audit flagged this file as dead code (`auth-provider-cleanup`). Confirm nothing on this branch still imports it, then take the delete. |

### A2. Behavioral-intelligence API cluster (main "ported the backend"; both evolved it)
Resolve together, keeping both sides' intent. Source: `lib/decision-os/behavioral/api/contracts.ts` (113),
`intelligence-handlers.ts` (139), `resolvers.ts` (51), `real-data-provider.ts` (64), `presentation-adapters.ts`
(16); plus `lib/decision-os/behavioral/index.ts` (22), `mappers.ts` (247), `port.ts` (245). Tests to
reconcile alongside: `behavioral-event-ports.test.ts` (246), `intelligence-api-real-provider.test.ts` (51),
`intelligence-api-routes.test.ts` (10), `intelligence-api-provider-selection.test.ts` (3),
`phase7/intelligence-api-presentation.test.ts` (22). **Guidance:** `main`'s version is the more recent
backend port — prefer it where they diverge, then re-apply any behavior this branch's tests require. Run
`__tests__/decision-os/` after.

### A3. UI + import surfaces
| File | Lines | Guidance |
| --- | --- | --- |
| `app/dashboard/components/DashboardOverview.tsx` | 864 | main's rankings/import UI phases — prefer main, re-apply any Demo-Truth/provider-neutral copy from here |
| `components/landing/LandingPageClient.tsx` | 986 | main's landing/journey work — prefer main |
| `components/unified-import-ui/LeagueImportFlow.tsx` | 799 | main's import fidelity UI — prefer main |
| `app/page.tsx` | 24 | small — reconcile by hand |
| `lib/league-import/adapters/sleeper/SleeperLeagueMapper.ts` | 106 | main's Sleeper import fidelity (traded picks/waiver/settings) — prefer main |
| `lib/league-import/types.ts` | 75 | union both sides' type additions |

## B. Divergent but AUTO-MERGEABLE (sanity-check only — NOT hard conflicts)

These have large diffs but git resolves them (non-overlapping hunks). Eyeball after merge:
`lib/i18n/translations.ts` (1388 — both added different keys), **`app/globals.css` (625 — both changed
different sections; verify both token sets survive)**, `lib/league-import/ImportedLeagueCommitService.ts`
(173), `app/dashboard/DashboardShell.tsx` (152), `app/components/AppShell.tsx` (45), `app/admin/page.tsx`
(18), `package.json` (17 — confirm no dependency/script dropped from either side).

## C. Migrations (production-critical)

- The **4 overlapping migrations** (`event_foundation`, `event_projections`, `outbox_claim`,
  `intelligence_read_models`) are **byte-identical** on both branches → no divergence.
- **3 branch-only new migrations** would run on merge: `add_redraft_roster_move_history`,
  `add_trade_learning_live_capture`, `add_replay_framework`. Verify these against the merged
  `schema.prisma` (A1) and apply in order after merge.

## D. Recommended order

1. `prisma/schema.prisma` + migrations (A1, C) — with a DB reviewer.
2. `SocialLoginButtons.tsx` modify/delete decision (A1).
3. Behavioral-intelligence API cluster (A2) → run `__tests__/decision-os/`.
4. UI/import surfaces (A3).
5. Let git auto-merge the rest (B); sanity-check `globals.css` + `package.json`.
6. Full CI: typecheck (expect ~158 baseline), test suite, then Vercel deploy verification, then the
   four-route authenticated production smoke (`/fantasy-os`, `/manager-hub`, `/commissioner-hub`,
   `/league/[id]`).

## E. Guarantees during resolution

- Do **not** rewrite this branch's committed history (dashboard docs reference commit hashes).
- Keep Decision OS **invisible** on customer surfaces and outputs **provider-neutral** (the
  `customer-copy-neutrality` guard enforces this — keep it green).
- No force-push. Resolve on the branch (or a resolution branch) and let human review + CI gate the merge.

*No merge, deployment, or production change was performed to produce this map.*

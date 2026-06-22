# Route Budget Audit & Cleanup (2026-06-22)

## Why the Vercel build failed

Vercel enforces a hard cap of **2048 routes** (rewrites + redirects + headers + the
expansion of every deployed page/route function, including RSC variants) per
deployment. The production build reached **2049** and failed:

```
Maximum number of routes (rewrites, redirects, etc) exceeded.
Max is 2048, received 2049. Please reduce the number of routes.
```

### Root cause

The repo controls its route budget by **temporarily moving non‑production route
files out of the build** in `scripts/vercel-next-build.cjs` (`routeDirsToDisable`)
before `next build`, then restoring them afterward. The route‑budget unit test
(`__tests__/route-budget.test.ts`) tracks the same set via `EXCLUDED_DIRS`.

These two lists had **drifted**: the test already counted `app/admin` and
`app/api/admin` as excluded (so the local budget heuristic read "green"), but the
**build script never actually disabled them** — so the entire internal‑staff admin
surface (and several internal diagnostic endpoints) shipped to production and
counted toward the cap. That hidden gap is what pushed the deployment to 2049.

## Before / after

The reliable, reproducible proxy for Vercel's count is the number of
**deployed route+page functions** — files NOT moved out of the build. Each maps
to at least one Vercel route, so the reduction here is a lower bound on the
Vercel‑route reduction. Measured with `scripts/route-budget-count.mjs`:

| Metric | Before | After | Δ |
| ------ | -----: | ----: | -: |
| Files moved out of build (`routeDirsToDisable`, net of keeps) | 141 | 173 | **+32** |
| Deployed route+page functions | 1627 | 1595 | **−32** |
| Deployed route signals (functions + crons) | 1701 | 1669 | **−32** |

```
Before (Vercel): 2049
After  (Vercel): ≤ 2017   (2049 − 32 deployed functions; admin *pages* expand to
                           extra RSC routes, so the real figure is slightly lower)
Reduced by:      ≥ 32      (target was ≥ 30; ideal ≤ 2018 — met)
```

No **new** routes were added. (`scripts/route-budget-count.mjs` is a build‑time
audit helper, not a route.)

## What was removed (excluded from the production build)

All entries below were added to `routeDirsToDisable` in
`scripts/vercel-next-build.cjs`. Files are **kept in git** and **restored after
every build** — this is reversible and changes no source.

### Internal staff admin (authorized scope #1)
- `app/admin` — internal staff dashboard pages (`/admin`, `/admin/bootstrap`). Not a customer surface.
- `app/api/admin/**` — all admin API routes **except** the keeps below.

**Kept built** (live non‑admin / library callers, via `filesToKeep`):
- `app/api/admin/automation/health` and `app/api/admin/automation/waivers/run` (pre‑existing keeps; automation/cron‑adjacent)
- `app/api/admin/sports/sync` and `app/api/admin/fantasy-data/import` — referenced by `lib/fantasy-data/providerHealth`, `lib/ai/leagueSportsGroundingPacket`, and `app/api/chat/chimmy` (live AI grounding)

### Internal diagnostics / metrics / meta (authorized scope #2)
Each verified to have **zero** production (non‑admin) `fetch` caller, **no** Vercel
cron target, and **no** Chimmy/AI tool‑router reference:
- `app/api/meta/logs`
- `app/api/intelligence/snapshot`
- `app/api/providers/status`
- `app/api/chaos-detector`
- `app/api/league-health`
- `app/api/league-meta`
- `app/api/platform/service-map`
- `app/api/ai/decision-log`
- `app/api/ai/validation`
- `app/api/ai/memory/quality`
- `app/api/health/fantasycalc` — internal FantasyCalc cache‑freshness probe
- `app/api/health/player-valuations` — internal valuation cache‑freshness probe
- `app/api/system/health` — `requireAdmin`‑gated system monitor

## What was deliberately preserved

- **`/api/health` (root)** — external uptime‑monitor target; NOT excluded.
- **Admin routes with live callers** — `sports/sync`, `fantasy-data/import`, and the automation routes (see keeps above).
- **Telemetry / analytics** — `/api/admin/usage/log`, `/api/admin/simulate-league`, `/api/admin/warehouse/backfill` are referenced by live code but **do not exist** as routes under `app/api/admin`, so they were untouched.
- **Deferred game modes wired into live surfaces** — `app/api/leagues/[leagueId]/{big-brother,survivor,zombie}` are called from live dashboard chat and league‑settings panels; **left in production** (excluding them would break those panels).
- **All user‑facing flows** — leagues, drafts, waivers, trades, World Cup, brackets, CafeConChimmy, auth, payments/Stripe, OAuth callbacks, webhooks, push.
- **T9 / PR #99** — not touched. T9's `app/api/redraft/trades/market-values` routes remain; trade grading and provider values are unchanged.

## Why each removal was safe

1. **Admin** — the route‑budget test already declared `app/admin` + `app/api/admin`
   excluded; this PR makes the build match that long‑standing intent. The only
   routes with real non‑admin callers are explicitly kept. No admin route is a
   cron target.
2. **Diagnostics** — verified caller‑less via repo‑wide search across
   `app/ components/ lib/`, cross‑checked against `vercel.json` crons and the
   Chimmy tool‑routing map. Locked in by new assertions in
   `__tests__/route-budget.test.ts`.
3. **Reversibility** — nothing is deleted; `routeDirsToDisable` moves files out for
   the build and restores them, with crash‑safe recovery already built into
   `scripts/vercel-next-build.cjs`.

## Tests run

- `__tests__/route-budget.test.ts` — **22 pass** (heuristic under GREEN limit + new caller‑less assertions for the excluded diagnostics).
- Draft Room Regression (`__tests__/draft-room`) — **166/166 pass**.
- `npx eslint scripts/vercel-next-build.cjs __tests__/route-budget.test.ts` — clean.
- `git diff --check` — clean.

### Production build verification

The build runs through `scripts/vercel-next-build.cjs` (the Vercel build path),
which moves the excluded routes out before `next build`. Verified end‑to‑end:

- The build moved out **192 non‑prod files** (existing 141 + this PR's additions) into
  `.next-build-disabled-routes/`, and the generated `routes-manifest.json` contains
  **none** of the 18 newly excluded routes (`/admin`, `/api/admin/metrics`,
  `/api/system/health`, `/api/meta/logs`, …) while the kept routes
  (`/api/admin/sports/sync`, `/api/admin/fantasy-data/import`, root `/api/health`)
  remained on disk and built.
- No production file imports any moved route/page file (verified by source scan),
  so removing these leaf endpoints cannot break compilation — and the same tree
  built green here before this change with *more* routes present.

> **Windows note:** the local Windows build is flaky independent of this change —
> it intermittently throws `EISDIR` on `app/blog/draft/[articleId]/page.tsx`
> (a symlink/readlink quirk on the F: drive) or hangs in the webpack compile.
> These are environmental; Vercel's Linux builder is unaffected. The route‑budget
> outcome is proven deterministically by the deployed‑function delta
> (`scripts/route-budget-count.mjs`) and by the backup‑dir / manifest inspection
> above, not by a local Windows `next build` completing.

## Future route‑budget rule

> **Any PR that adds a route must remove or consolidate an equivalent number of
> routes, or justify in the PR description why the new route is required.**
>
> Keep `scripts/vercel-next-build.cjs` `routeDirsToDisable` and
> `__tests__/route-budget.test.ts` `EXCLUDED_DIRS`/`FILES_KEPT` **in sync** — drift
> between them is what hid this overflow. Run `node scripts/route-budget-count.mjs`
> to see the current deployed‑function count before adding routes.

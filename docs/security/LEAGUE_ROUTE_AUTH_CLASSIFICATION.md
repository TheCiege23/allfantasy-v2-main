# `app/api/leagues/[leagueId]/` — ungated route classification (Phase 1)

Measured against `main` @ `7e1d894d4` (#309). **Classification only — this PR changes no code.**

## Headline numbers (re-derived, not inherited)

| Metric | Count |
|---|---|
| Route files under `app/api/leagues/[leagueId]/` | 331 |
| Gated in-file | 278 |
| Gated via re-export delegation (false positives in a naive count) | 3 |
| **Truly ungated** | **50** |
| …with a mutating verb | 25 |
| …that call an LLM | 7 |
| …with a **direct** Prisma write in the route file | **1** |
| …invoked by a cron | **0** |

### Corrections to the earlier estimate

The first sweep reported ~65–66. Three refinements brought it to **50**:

1. **Re-export delegation.** `draft/actions`, `draft/trade-proposals/[proposalId]/respond`, and
   `survivor` are `export { … } from '…'` one-liners whose gate lives in the target module. A
   route-file grep cannot see that.
2. **Incomplete auth-marker list.** Routes gating via `getLeagueRole`, `requireEntitlement`, or
   `requireDispersalDraftForLeague` were miscounted as ungated — this removed the whole
   `*-war-room/[action]` family and `dispersal-draft/*`.
3. **"Anonymous write" was overstated.** Only **one** ungated route (`season-forecast`) contains a
   direct Prisma write. Everything else delegates to a service/engine lib, so persistence must be
   traced through the lib per route — a route-file grep cannot establish it. `drama/run` in
   particular shows **no** direct write; the honest label is "zero-auth engine run, persistence
   unverified", not "anonymous write".

**Confirmed-real exposures** (verified by reading the route, not inferred):
`season-results` POST → `upsertSeasonResults({… champion: !!r.champion })`, an anonymous write of
champion flags. `forecast-summary` POST → imports `openaiChatText` and calls OpenAI with no caller
identity (anonymous token burn).

## The cron question — settled, and it de-risks Phase 2

**No cron invokes any of these 50.** No route under `app/api/cron/` targets them, and `vercel.json`
declares 29 crons, none on an `/api/leagues/` path. Every caller found is **browser-side**:
`lib/best-ball-war-room/client.ts`, `lib/dynasty-war-room/client.ts`, `lib/keeper-war-room/client.ts`,
`lib/guillotine-war-room/client.ts`, `lib/redraft-war-room/client.ts`, `lib/hooks/useSurvivorLiveSse.ts`,
`lib/dashboard/dashboard-draft-overlay-bridge.ts`, `lib/draft-engine/index.ts`.

So the #1 outage risk — gating a cron-driven route with a user session — **does not apply to this
set**. Session + membership is the correct gate throughout.

⚠ One exception to confirm in Phase 2: `lib/unified-ai/ToolAIEntryResolver.ts` references
`psychological-profiles/explain` and `legacy-score/explain`. If that resolver runs server-side, it
must forward the caller's cookie or those two routes will break when gated.

## Classification

Category key — **(a)** member-only read · **(b)** member-only write · **(c)** commissioner-only ·
**(d)** cron-only · **(e)** genuinely public read.

**No route classified (d).**

### Batch 1 — mutating + LLM (Phase 2 target, worst first)

| Route | Methods | Class | Rationale |
|---|---|---|---|
| `season-results` | POST | **(c)** | Writes champion flags — league-state mutation. Confirmed real anonymous write. |
| `season-forecast` | GET, POST | **(c)** | Only route with a direct Prisma write; POST runs + persists a simulation. |
| `snapshots` | POST | **(c)** | Persists ranking snapshots. |
| `v3/weights` | GET, POST | **(c)** | Ranking weight config — changes how every member's rankings compute. |
| `v3/drift` | GET, POST | **(c)** | Same config surface as above. |
| `draft-grades` | GET, POST | **(c)** | POST writes grades for the whole league. |
| `hall-of-fame` | GET, POST | **(c)** | POST rebuilds league-wide records. |
| `hall-of-fame/run` | POST | **(c)** | Rebuild. |
| `hall-of-fame/sync-moments` | POST | **(c)** | Rebuild. |
| `drama/run` | POST | **(c)** | Engine run. *Persistence unverified — trace `LeagueDramaEngine` before gating.* |
| `legacy-score/run` | POST | **(c)** | Engine run + persist. |
| `reputation/run` | POST | **(c)** | Engine run + persist. |
| `psychological-profiles/run` | POST | **(c)** | Engine run + persist. |
| `psychological-profiles/run-all` | POST | **(c)** | League-wide rebuild. |
| `rivalries` | GET, POST | **(c)** | POST runs the rivalry engine. |
| `relationship-insights` | GET, POST | **(b)** | POST computes viewer-scoped insight. |
| `dynasty-projections` | GET, POST | **(b)** | POST computes projections. |
| `forecast-summary` | POST | **(b)** + LLM | **Confirmed anonymous OpenAI spend.** |
| `hall-of-fame/tell-story` | POST | **(b)** + LLM | Anonymous OpenAI spend. |
| `legacy-score/explain` | POST | **(b)** + LLM | Anonymous OpenAI spend. |
| `reputation/explain` | POST | **(b)** + LLM | Anonymous OpenAI spend. |
| `rivalries/explain` | POST | **(b)** + LLM | Anonymous OpenAI spend. |
| `psychological-profiles/explain` | POST | **(b)** + LLM | Anonymous OpenAI spend. ⚠ ToolAIEntryResolver caller. |
| `relationship-insights/explain` | POST | **(b)** + LLM | Anonymous OpenAI spend. |
| `survivor/[...path]` | GET/POST/PUT/PATCH/DELETE | **needs hand-check** | Dynamic loader that lazy-loads route modules; the gate may live in each target. Do **not** batch-gate — resolve per sub-route first. |

### Batch 2 — reads exposing league-private data (Phase 3)

All **(a) member-only read** — league-private analytics, standings-derived records, and
manager-profile data that a non-member should not enumerate by league id:

`drama`, `drama/[eventId]`, `drama/timeline`, `hall-of-fame/entries`,
`hall-of-fame/entries/[entryId]`, `hall-of-fame/moments`, `hall-of-fame/moments/[momentId]`,
`legacy-score`, `legacy-score/breakdown`, `psychological-profiles`,
`psychological-profiles/[profileId]`, `psychological-profiles/[profileId]/evidence`, `reputation`,
`reputation/compare`, `reputation/evidence`, `rivalries/[rivalryId]`,
`rivalries/[rivalryId]/head-to-head`, `rivalries/[rivalryId]/timeline`, `relationship-map`,
`relationship-profile`, `power-rankings`, `rank-history`, `ldi-heatmap`, `partner-profiles`,
`draft/config`.

**Candidates for (e) genuinely public — an explicit decision is required, do not default:**
`power-rankings`, `rank-history`, `draft/config`. These are plausibly shareable, and `draft/config`
may be read pre-join during an invite flow. If any stays public, Phase 3 must leave it ungated **with
a one-line comment recording the decision**, per the sweep constraints.

## Out of scope (tracked, not in this sweep)

Authenticated but **membership**-ungated — any signed-in user, any `leagueId`:
`finance/entry-checkout` (creates a **Stripe checkout**, leaks league name + entry fee),
`commissioner-rating/trigger`, `graph-insight`, `simulation-insights`. `finance/entry-checkout` is
named in the Phase 2 scope and should land in that PR.

## Method

`app/api/leagues/[leagueId]/**/route.ts` walked; each file scanned for auth markers (session, membership,
role, entitlement, cron-secret), exported HTTP verbs, direct Prisma writes, and LLM imports; one hop of
`export { … } from` delegation resolved to check whether a gate lives in the target. Counts are
reproducible from the classifier in the PR description.

**Known limits.** Detection is per-file: a gate applied by middleware or a wrapper the classifier does
not recognise would read as ungated, and persistence inside a service lib is invisible here. Every
route in Batch 1 must still be opened by hand in Phase 2 before its gate is chosen.

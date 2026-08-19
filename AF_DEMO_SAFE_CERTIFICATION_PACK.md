# AllFantasy — Demo-Safe Certification Pack

**Scope:** Demo-Risk items #1–#6 from `AF_DATA_PROVENANCE_AUDIT.md`
**Branch verified:** `fix/access-tier-and-landing`
**Prepared:** Jul 15, 2026 · by Cowork (strategic planner) for the Claude Code executor
**Posture:** Verification-first. Do not re-fix what is already correct in source.

---

## 0. Why this is a certification pack, not a fix pack

When the demo-risk register was built, the audit was current. It no longer is — **for these six items only**. Every one of the six files was modified *after* the audit was written (the audit is timestamped ~15 minutes before the first of these edits), and a read of the current source shows all six were already addressed today. The code even references the audit findings in its own comments.

Per your own status vocabulary, that puts these six at **source-complete** — **not** test-complete, runtime-certified, or production-verified. This pack closes that exact gap: it proves each fix is real against live data, catches the residuals that source review alone can't see, and locks each one with a regression test so it can't silently revert.

**Rule for the executor:** trust current source, callers, tests, and runtime — not this document and not the old audit. Every prompt below begins by *re-verifying the current state on disk* before doing anything. If any item is found already certified (test + runtime evidence present), record that and move on.

### Status at a glance

| # | Item | Audit finding (now stale) | Current source state | Evidence (file:line) | Remaining work |
|---|------|---------------------------|----------------------|----------------------|----------------|
| 1 | Team Direction valuations | Stub always returned empty map → flat position+age prices | **Fixed** — calls real `fetchFantasyCalcValues()` and populates the value map | `…/legacy/rankings/analyze/route.ts:541-565` | Certify FC map is non-empty at runtime; measure fallback rate; (optional) route through canonical module |
| 2 | Opponent Behavior grades | Letter grade / winner / trash-talk were raw GPT-4o, non-reproducible | **Fixed** — deterministic `computeWeightedScore()`/`scoreToGrade()`, overwritten server-side; LLM narrative-only | `…/legacy/compare/route.ts:281-347, 464-634` | Certify determinism (same input → same grade) + unit test on the weights |
| 3 | "Live data connected" chip | Hardcoded green, no check | **Fixed** — `useDataProviderHealth()` → real `/api/health/data-providers` | `DashboardHeader.tsx:18-44,128-142` · `api/health/data-providers/route.ts` | Certify negative path (stale cache → not green). **Residual: offseason weather-cache gap** — see #3 |
| 4 | Trade Command Center dual % | Two disagreeing acceptance numbers | **Fixed** — single `computeTradeAcceptance()` source of truth; prompt forbids LLM's own number | `…/legacy/trade/proposal-generator/route.ts:401-476,540` | Certify exactly one acceptance number survives to the response + test |
| 5 | Dead Archetype tile | Always rendered "—" | **Fixed** — tile removed; 3 real tiles + honest empty state | `app/dashboard/components/LegacySnapshotCard.tsx:20-113` | Lightest — render test + screenshot |
| 6 | Championship count mismatch | Two code paths could diverge | **Fixed** — unified on branch-aware `careerStats.championships` | `app/api/user/rank/route.ts:390,481,731` | Certify both UI surfaces show the same number for a dual-history user + test |

---

## 1. How to run this pack

Work the items in this order: **#3 → #1 → #4 → #2 → #6 → #5.** (#3 has a real residual decision; #1 is the highest-severity original finding; #5 is trivial and goes last.) Each item is an independent, copy-pasteable Claude Code prompt with a hard stop gate. Do not batch them — land, prove, and commit one at a time.

**Global gate (must pass before *and* after each item):**

```
npm run typecheck        # zero new errors attributable to the touched file
npm run build            # clean (the Windows readlink EISDIR notice is the known non-failure)
npm run test -- <suite>  # the item's named test(s), green
```

**Global demo-day gate (run once, after all six are certified):** one real browser pass against a **real Sleeper account with imported history**, capturing a screenshot of each surface (Team Direction rankings, Compare/Opponent Behavior, dashboard header chip, Trade Command Center, dashboard Legacy Snapshot, `/af-rankings` career stats). No fabricated number on any screen. File the screenshots as the runtime evidence.

> **Never** report an item "done" on source inspection alone. The definition of done for every item below requires *runtime evidence* (a log line, a test result, or a screenshot), per the source-complete → runtime-certified distinction.

---

## 2. Item prompts

### Item #3 — Certify the "Live data connected" chip (and resolve the offseason weather gap)

**Current state (verified):** `DashboardHeader.tsx` calls `useDataProviderHealth()` → `GET /api/health/data-providers`, which checks `sportsDataCache` and `weatherCache` freshness (24h window) and returns `ok: sportsOk && weatherOk`. The chip renders `connected` / `degraded` / `checking`.

**Residual risk (this is the real work):** `ok` requires **both** sports **and** weather caches fresh. It is July — NFL offseason. If `weatherCache` is empty or stale in the offseason (very likely, since weather only matters on game days), the chip will show "Data sync delayed" **permanently and incorrectly**, which is its own demo embarrassment — the opposite failure of the original bug. This needs a product decision, then certification of both the true and false paths.

```
CONTEXT: Certifying demo-risk #3 (dashboard "Live data connected" chip). The chip was
fixed today: app/dashboard/universal/components/DashboardHeader.tsx uses useDataProviderHealth()
which fetches /api/health/data-providers (app/api/health/data-providers/route.ts). Do NOT
rebuild the chip — verify it and resolve one residual.

OBJECTIVE:
1. Re-read both files on disk and confirm the current wiring matches the above. If it has
   changed, stop and report the delta before proceeding.
2. RESIDUAL DECISION: the route returns ok = (sportsOk && weatherOk). Determine whether
   weatherCache is expected to be fresh during the NFL offseason. Query the actual table:
   SELECT MAX("fetchedAt") FROM "weatherCache";  and  SELECT MAX("createdAt") FROM "sportsDataCache";
   - If weather is legitimately stale/empty in the offseason, change the health semantics so a
     healthy chip does NOT depend on weather during the offseason (e.g. gate weather on
     in-season, or treat weather as a secondary signal that degrades to a tooltip note, not the
     top-level ok). Keep sports freshness as the primary signal. Make the smallest change that
     makes "connected" TRUE when sports data is genuinely fresh.
3. CERTIFY BOTH PATHS with runtime evidence:
   - POSITIVE: with a fresh sportsDataCache row, hit GET /api/health/data-providers and confirm
     { ok: true }. Load the dashboard; confirm the chip reads "Live data connected".
   - NEGATIVE: temporarily force the sports freshness check to fail (e.g. point FRESH_WINDOW_MS
     tiny, or test against an empty cache in a scratch DB) and confirm the route returns ok:false
     and the chip reads "Data sync delayed" — proving it is no longer hardcoded green.
4. Add a regression test: __tests__/health/data-providers.test.ts — assert ok=true only when
   the primary (sports) signal is fresh, and ok=false when it is stale. Cover the offseason case.

SCOPE (only these files):
  - app/api/health/data-providers/route.ts   (semantics change, if the decision requires it)
  - app/dashboard/universal/components/DashboardHeader.tsx   (only if copy/state needs it)
  - __tests__/health/data-providers.test.ts   (new)

FORBIDDEN:
  - Do not restore any hardcoded/unconditional "connected" markup.
  - Do not claim connectivity for feeds the route does not actually check.
  - Do not touch unrelated dashboard components.

STOP GATE: npm run typecheck && npm run build && npm run test -- data-providers  all green.
DEFINITION OF DONE: the offseason decision is recorded in a code comment; positive AND negative
runtime evidence captured (route JSON + chip screenshot each way); regression test green.
```

---

### Item #1 — Certify Team Direction valuations are real (no silent fallback to flat prices)

**Current state (verified):** `getFantasyCalcValues()` (`…/rankings/analyze/route.ts:541`) now calls `fetchFantasyCalcValues({ isDynasty, numQbs, numTeams, ppr })` and builds a name→value map. `calculatePositionalValuesWithPlayers()` uses that map; only when a player is missing does it fall back to `getPositionBaseValue() * getAgeAdjustment()` (the flat 4000/3500 that was the whole bug).

**Residual risk:** the fallback is silent. If `fetchFantasyCalcValues` throws or returns `[]` at runtime (bad key, provider outage, name-mismatch), **every** player silently gets the flat price and the tier label looks real but isn't — the original demo risk, reintroduced invisibly. Certification must prove the map is populated *and* measure how many players actually price from FantasyCalc vs the fallback.

```
CONTEXT: Certifying demo-risk #1 (Team Direction / rankings-analyze player valuations).
File: server/api-route-modules/legacy/rankings/analyze/route.ts. The empty-map stub is already
gone — getFantasyCalcValues() (line ~541) now calls fetchFantasyCalcValues() and populates a
map; calculatePositionalValuesWithPlayers() (line ~567) falls back to getPositionBaseValue()
only per-missing-player. Do NOT rewrite the valuation logic — certify it and make the fallback
observable.

OBJECTIVE:
1. Re-read the file; confirm the wiring above still matches disk.
2. Run the Team Direction analysis against a REAL Sleeper league (imported, with a real roster).
   Add a temporary instrumented log (remove before commit) that reports, for that run:
     - fantasyCalcValues.size (must be > 0)
     - count of players priced FROM FantasyCalc vs FROM the position+age fallback
     - the resulting overallScore + tier for the user's team
   Capture the log output as evidence. PASS = map non-empty AND the large majority of rostered
   players priced from FantasyCalc (a high fallback rate means name-matching is broken — report
   it, do not paper over it).
3. NEGATIVE proof: confirm the failure mode is now loud, not silent. The catch at line ~561
   already console.errors on FC failure — verify that fires when the provider is unreachable,
   so a total FC outage is diagnosable rather than showing flat prices as if real.
4. (OPTIONAL, architecture — only if trivial) This route imports fetchFantasyCalcValues from
   '@/lib/fantasycalc' directly. The canonical, provider-neutral module
   '@/lib/player-valuations/canonicalPlayerValuations' re-exports the same function as
   getCanonicalPlayerValuations. If swapping the import is a one-line, behavior-identical change,
   do it to honor the "no direct-provider coupling in product code" rule. If it changes behavior
   at all, DO NOT — leave a TODO and move on.
5. Add a regression test: assert that when FantasyCalc returns a non-empty set, at least one
   rostered player's value comes from FC (not the flat base), and that tiers are assigned from
   real overallScore ordering.

SCOPE:
  - server/api-route-modules/legacy/rankings/analyze/route.ts  (import swap optional; temp log removed before commit)
  - __tests__/legacy/rankings-analyze-valuations.test.ts  (new)

FORBIDDEN:
  - Do not reintroduce any path that prices a full roster from getPositionBaseValue when FC data
    is available.
  - Do not leave the instrumentation log in the committed code.

STOP GATE: npm run typecheck && npm run build && npm run test -- rankings-analyze  all green.
DEFINITION OF DONE: runtime log proving fantasyCalcValues.size>0 and low fallback rate for a real
league; screenshot of the Team Direction tab with believable per-player values (not uniform
4000/3500); regression test green.
```

---

### Item #4 — Certify a single trade-acceptance number

**Current state (verified):** `proposal-generator/route.ts:401-438` computes acceptance via `computeTradeAcceptance()` (from `lib/analytics/trade-acceptance.ts`, confirmed present) before the LLM. The prompt (`:470-476`) tells the model this is "the ONLY acceptance number that exists; do not estimate your own, do not include an 'acceptance' field." Only `acceptanceModel.score` is returned (`:540`, surfaced as `acceptProb :607`).

**Residual risk:** the LLM is *instructed* not to emit its own number, but instruction ≠ guarantee. If a model response slips an `acceptance`/`acceptancePct` field into the proposal object and any UI reads it, the two-number bug returns. Certification proves only one number reaches the client.

```
CONTEXT: Certifying demo-risk #4 (Trade Command Center dual acceptance %). File:
server/api-route-modules/legacy/trade/proposal-generator/route.ts. Already fixed: acceptance is
computed deterministically via computeTradeAcceptance() (line ~428) and the LLM prompt (line ~470)
forbids the model from emitting its own. Do NOT rework the acceptance model — certify singularity.

OBJECTIVE:
1. Re-read the file; confirm computeTradeAcceptance is the only acceptance source and the prompt
   still forbids an LLM-authored number.
2. Runtime proof against a real league: generate trade proposals and inspect the full JSON
   returned to the client. Confirm EXACTLY ONE acceptance figure exists per proposal
   (acceptanceModel.score / acceptProb) and that NO stray field (acceptance, acceptancePct,
   pitchAcceptance, likelihood) appears anywhere in the proposal or theirPitch text as a
   competing percentage.
3. Add a guard + test: after parsing the LLM JSON, assert/strip any acceptance-like field the
   model may have added despite the instruction (belt-and-suspenders), and a unit test that feeds
   a mock LLM response containing a rogue "acceptance": 88 and confirms it never reaches the
   response — only the computed score does.

SCOPE:
  - server/api-route-modules/legacy/trade/proposal-generator/route.ts  (add defensive strip only)
  - __tests__/legacy/trade-proposal-acceptance.test.ts  (new)

FORBIDDEN:
  - Do not add any second acceptance estimate.
  - Do not let the LLM's number override computeTradeAcceptance under any branch.

STOP GATE: npm run typecheck && npm run build && npm run test -- trade-proposal-acceptance  green.
DEFINITION OF DONE: runtime JSON showing one acceptance number per proposal; the rogue-field test
green; screenshot of the Trade Command Center with a single acceptance % shown.
```

---

### Item #2 — Certify deterministic Opponent Behavior grades

**Current state (verified):** `compare/route.ts` computes grades from real stats via `computeWeightedScore()` (`:307`, weights champ 35 / win% 25 / playoff 25 / consistency 15) and `scoreToGrade()` (`:289`), **before** the LLM, then overwrites `overall_grade`/`grades_by_type.*.grade`/`winner`/`margin` server-side (`:611-634`). LLM does verdict/trash-talk/strengths/weaknesses only, with a deterministic-only fallback on LLM failure (`:566-571`).

**Residual risk:** low — the design is sound. Certify determinism and that displayed == computed.

```
CONTEXT: Certifying demo-risk #2 (Opponent Behavior / Compare tab grades). File:
server/api-route-modules/legacy/compare/route.ts. Already fixed: grades are computed
deterministically (computeWeightedScore line ~307, scoreToGrade line ~289) and overwritten
server-side after the LLM (lines ~611-634). Do NOT change the weights or the grading — certify it.

OBJECTIVE:
1. Re-read the file; confirm grades/winner/margin are overwritten server-side from the
   deterministic values regardless of LLM output.
2. Determinism proof: run the same Compare (same two managers, same data) TWICE and confirm
   overall_grade, grades_by_type.*.grade, winner, and margin are byte-identical across runs.
3. Verify displayed == computed: confirm the values the client receives equal the
   computeWeightedScore/scoreToGrade outputs for the same inputs (not the LLM echo).
4. Add a unit test on the pure functions: feed known stat totals into computeWeightedScore and
   assert the score matches the documented weights, and scoreToGrade maps boundaries correctly.
5. Verify the LLM-failure fallback returns real grades with a narrative-unavailable message (not
   an error surface).

SCOPE:
  - server/api-route-modules/legacy/compare/route.ts  (test hooks only if needed; no logic change)
  - __tests__/legacy/compare-grades.test.ts  (new)

FORBIDDEN:
  - Do not let any LLM-authored grade/winner survive into the response.
  - Do not alter the disclosed weights without an explicit product decision.

STOP GATE: npm run typecheck && npm run build && npm run test -- compare-grades  green.
DEFINITION OF DONE: two identical-input runs producing identical grades (evidence captured);
weights unit test green; screenshot of a Compare result.
```

---

### Item #6 — Certify one championship count everywhere

**Current state (verified):** `user/rank/route.ts` now sources championships from the branch-aware `careerStats.championships` at `:390`, `:481`, and `:731` (the dashboard `RankingsCard` path), with a comment explaining the prior divergence from the legacy-table-only `championshipCount`. `careerChampionships` at `:767` falls back to the same `careerStats.championships`.

**Residual risk:** low — certify the two consuming surfaces now agree for a user with *both* Sleeper-imported and legacy-table history (the only case that ever diverged).

```
CONTEXT: Certifying demo-risk #6 (championship count mismatch). File: app/api/user/rank/route.ts.
Already fixed: championship counts now come from branch-aware careerStats.championships at lines
~390/481/731. Do NOT re-plumb the stats — certify the two UI surfaces agree.

OBJECTIVE:
1. Re-read the file; confirm every championship figure the API returns derives from
   careerStats.championships (no raw legacy-table-only championshipCount path remains for the
   dashboard surface).
2. Runtime proof with a user who has BOTH Sleeper-imported history AND legacy-table history (the
   only case that diverged). Hit /api/user/rank and confirm the dashboard RankingsCard field and
   the /af-rankings CareerStats field show the SAME number. Capture both screenshots.
3. Add a test asserting both response fields (the dashboard-consumed count and the /af-rankings
   CareerStats count) resolve to careerStats.championships for a fixture user with mixed history.

SCOPE:
  - app/api/user/rank/route.ts  (no logic change expected; only if a stray path remains)
  - __tests__/user-rank-championships.test.ts  (new)

FORBIDDEN:
  - Do not reintroduce a UI surface that reads a championship count from a different source.

STOP GATE: npm run typecheck && npm run build && npm run test -- user-rank-championships  green.
DEFINITION OF DONE: two screenshots (dashboard + /af-rankings) showing the same championship
number for a mixed-history user; test green.
```

---

### Item #5 — Certify the Archetype tile is gone and the empty state is honest

**Current state (verified):** `LegacySnapshotCard.tsx` removed the always-"—" Archetype tile; it now renders three real tiles (AF Rank, Tier, XP) reading `levelName`/`tierName`/`xpTotal`, with an "Import to unlock" CTA when there's no data. Lowest-risk item.

```
CONTEXT: Certifying demo-risk #5 (dead Archetype tile). File:
app/dashboard/components/LegacySnapshotCard.tsx. Already fixed: the Archetype tile was removed;
three real tiles + honest empty-state CTA remain. Do NOT add anything back — certify it.

OBJECTIVE:
1. Re-read the file; confirm no "Archetype" tile and no field that renders a permanent "—".
2. Render test (React Testing Library): with a populated rankPayload, assert AF Rank/Tier/XP show
   real values and the string "Archetype" is absent; with an empty payload, assert the
   "Import a Sleeper league to unlock" CTA renders (data-testid="legacy-snapshot-import-cta") and
   no bare "—" placeholder tile is presented as if it were data.
3. Screenshot the dashboard Legacy Snapshot card in both states.

SCOPE:
  - __tests__/dashboard/legacy-snapshot-card.test.tsx  (new)   [no source change expected]

FORBIDDEN:
  - Do not reintroduce any tile that can only ever render "—".

STOP GATE: npm run typecheck && npm run test -- legacy-snapshot-card  green.
DEFINITION OF DONE: render test green for both states; two screenshots captured.
```

---

## 3. After the pack

Once all six carry runtime evidence + a regression test, they move from **source-complete** to **runtime-certified** — and you can put AllFantasy in front of a real commissioner or investor knowing nothing on those surfaces is fabricated. Two follow-ons worth queuing, both already on your board (not part of this demo-safe pass):

- **Lower-severity provenance items** still open: League Buzz aggregator (Large), Portfolio Analytics missing charts (Large), the dormant `lib/ranking/*` engine deletion (Medium), the 22 orphaned cron routes (Medium), and the unwired fake yearly-XP projection code (Small — delete it before it ever gets surfaced).
- **The rescue merge** (`wip/phase38-rescue`, 25 phases) remains the path to the full beta feature set — start with the six safe-to-take phases whenever you're ready.

I'll reflect this new status on the Launch Readiness Command Center so the board stays honest: these six now read as *source-fixed, pending certification* rather than *open*.
```

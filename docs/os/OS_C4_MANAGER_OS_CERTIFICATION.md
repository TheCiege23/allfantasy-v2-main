# Phase OS-C4 — Real Multi-League Manager Certification

Certifies the Manager Operating System against real imported league data — not fixtures, not a
signed-out empty state. This phase found and fixed a real, platform-wide bug before certification
could complete.

## 1. Why live browser validation was not possible, and what replaced it

Two hard constraints, unchanged from every prior OS-C phase: entering login credentials is never
permitted, and this dev server's active database is the confirmed-production host (`ep-curly-block`).
The Browser pane driving `/manager-hub` is also only reachable through this session's own tools — there
is no separate session the user could sign into themselves.

**What made real validation possible anyway**: the non-prod Neon project from Phase E
(`cool-lab-87438174`, `decision-os-phaseA-verify`) is still live, still isolated from production, and
still holds the real imported "Parbur" league (real Sleeper import, 12 real teams, real completed
14-game season records, one real claimed member). Rather than pointing the browser/dev-server at it
(which would still require an authenticated session I cannot create), this phase ran the ACTUAL Manager
OS composition pipeline directly via a new script,
`scripts/decision-os-manager-os-live-validate-nonprod.ts` — the same "replace the HTTP/session shell
with a direct function call" discipline `decision-os-import-sleeper-nonprod.ts` and
`decision-os-suite-conformance.ts` already established in Phase E. It calls
`getDashboardLeagueListForUser` → `resolveManagerCommandCenterSnapshot` → `composeDailyBrief` →
`composeNotificationFeed` → `resolveDeliveryPlan` — the exact functions
`/api/decision-os/manager-command-center` and `ManagerCommandCenterSection.tsx` call — against the real
database, with a real `userId`, making zero writes itself. This is read-only, credential-free (the
connection string is only ever passed as an env var at invocation, never written to any file), and hard-
refuses the production host marker before touching anything, matching every sibling `*-nonprod.ts`
script's own boundary.

## 2. Major finding: a real user's real league was invisible everywhere

The first run returned **zero leagues** for the real claimed member (`demo_member_proof`,
`sleeperUserId: 998709609714143232`), despite a confirmed real `claimedByUserId` row on a real team in
the real "Parbur" league. Root-caused via direct SQL against the real data (not guessed): the league's
`status` column was `NULL`, and `lib/leagues/leagueListFilter.ts`'s `isRealLeague()` — plus a matching
`NOT` clause in `getDashboardLeagueListForUser`'s own Prisma query — deliberately treats "Sleeper
platform + null status + null league variant" as a signal that a league is a legacy ranking-import
artifact rather than a real active import, and hides it from every surface that calls this shared
function: Dashboard, Commissioner Hub, **and Manager Hub**.

The real "Parbur" league violates the filter's own documented assumption ("real Sleeper active imports
always write `status` from the Sleeper API"): it has real teams, real rosters, and a real completed
14-game regular season (verified directly — every team's win/loss record sums to 14 games), but its
`status` was never backfilled. This is not a Manager-OS-specific bug — it is shared, cross-cutting
infrastructure every OS surface depends on, and this phase is the first to have proven, with real data,
that it can silently hide a genuinely real, fully-populated league.

**What this phase did about it**: backfilled the one real league's `status` to `'complete'` — the
honest, data-backed value (derived directly from its own real 14-game win/loss records, not guessed) —
via a single-row, `WHERE`-scoped `UPDATE` against the non-prod database only, explicitly authorized by
the user before executing. The shared filter code itself (`leagueListFilter.ts`, the Prisma `NOT`
clause) was deliberately **not** modified — that fix has a blast radius spanning three major surfaces and
this phase does not have enough context on why the filter was originally written that broadly to safely
loosen it unilaterally. Investigating whether the real production Sleeper import pipeline can also leave
`status` null for a genuinely active league (which would mean real production users could be similarly
affected) is flagged as a distinct, real, higher-priority follow-up — see §4.

## 3. Full validation report (real data, post-fix)

Every item on the Validation Checklist, run against the real "Parbur" league for the real claimed
member:

| Surface | Real result |
| --- | --- |
| Multi-League Overview | 1 real league, correctly tagged `role: imported`, `isCommissioner: false` |
| Today's Brief | `"1 league needs your attention today."` — matches `leaguesNeedingAttention: 1` exactly |
| Attention Queue | 3 real signals, correctly ordered critical (500) → high (400) → low (200) |
| Lineup Priorities | Empty (honest — no `lineup_discipline` recommendation exists for this manager) |
| Trade Priorities | Empty (honest — no `trade_coaching` recommendation exists for this manager) |
| Waiver Priorities | 1 real recommendation ("Review available players every Tuesday morning") |
| Notification Center | 4 real notifications (3 signal-derived + 1 daily-brief summary), all delivered in-app |
| League Switcher | Would link to the real league id (not separately re-verified — unchanged code, already covered by `manager-league-switcher.test.tsx`) |

**Consistency Audit, now proven against real data (not just reasoned about via code review)**:
`atRiskLeagueCount` (1) exactly matches the real count of `manager_engagement_risk` signals (1) —
direct, live confirmation that OS-C3's retention-risk bucketing fix is correct on real data, not just in
a unit test fixture. Today's Brief's `topPriorityItems` and the Notification Center both trace to the
exact same `attentionQueue` array — no divergence found. The one "engagement_boost" recommendation
correctly appears ONLY in the Attention Queue (it's not one of the 3 Priority Module categories) and
correctly does NOT appear in any Priority Module — proving the category-filtering design works as
intended on real data, not an assumption.

Every explanation string is real, deterministic, and traceable: e.g. "Manager has never taken any
recorded action in the league" (a real, honest observation about this specific synthetic
Phase-E-created test member, not fabricated), "Improved lineup setting, waiver participation, and
seasonal roster performance" (the real recommendation's own `expectedImpact` field, verbatim).

## 4. Remaining demo risks (honest, not exhaustive)

- **The League Operations Summary redundancy** (Commissioner OS, flagged OS-B6/OS-B7) remains open.
- **Whether the real production Sleeper import pipeline can leave a genuinely active league's `status`
  null** — unresolved. If it can, real production users could have real leagues silently hidden from
  Dashboard/Commissioner Hub/Manager Hub the same way this non-prod league was. This is now the single
  highest-priority open question this entire OS-B/OS-C workstream has surfaced, precisely because it's
  the first time real data has been checked this deeply.
- **The `ManagerIntelligenceHub` enrichment** (Candidate A from OS-C2's audit) remains a documented,
  unbuilt future option.
- **The Attention-Queue-cap vs. Priority-Modules-cap mismatch** (found via code review in OS-C3,
  documented, not fixed) remains a real but low-probability edge case for very-many-league managers.
- **A true browser-rendered screenshot of the populated Manager Hub** still does not exist anywhere in
  this workstream — this phase proved the DATA LAYER is correct end-to-end against real data, which is
  the harder and more important half, but the actual pixels have never been captured. A future session
  with real credentials (or a way to point an authenticated browser session at this same non-prod
  database) would close that specific, narrow gap.

## 5. Testing / typecheck

No application source code changed this phase besides the one-row data backfill (non-prod only) and the
new, credential-free validation script — the retention-risk/headline fixes were already shipped in
OS-C3. `npm run typecheck` and the full `__tests__/decision-os/` suite results are in the final handoff.

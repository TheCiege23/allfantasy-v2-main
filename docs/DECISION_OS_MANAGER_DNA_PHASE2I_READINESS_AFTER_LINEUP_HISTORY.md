# Manager DNA De-duplication — Phase 2I Readiness Verification (Post Lineup-History)

**Status:** Verification + one new measurement test file. No consumer migrated. No `lib/manager-dna.ts` change. No database connection made in this session — staging access was not requested (see §5).
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_PHASE2F_READINESS_AFTER_REDRAFT_PORT.md`, `docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md`, Phase 2H commit `a9d120692`

## TL;DR

**Lineup-history is real, wired, and fails safely — but it surfaced a genuinely new, more important finding than "we still need volume evidence."** Combining all four real redraft signal sources (trades, waivers, free-agent adds, lineup-history) for one synthetic manager, adding lineup-history to an already-real, confidently-correct `'committed_grinder'` profile **changed the identity to `'set_and_forget'`** — not because the manager's real trade/waiver/free-agent behavior said so, but because the newly-added lineup-history signal has real coverage gaps (this feature just shipped, no backfill is possible) that Phase 6.1 reads as a `conservative_roster_pattern`. This is exactly the "ramp-up period" risk Phase 2G predicted in its migration-risk section — now measured, not just anticipated. **The remaining blocker is NOT only real-world volume evidence anymore; it's now primarily this ramp-up misclassification risk, plus a smaller structural gap (several event types still have zero real data source at all).** Given that, a staging volume check right now would mostly just confirm the new table is empty (nothing has deployed yet) — not worth requesting yet. Verdict unchanged: **NO-GO for AI Coach.**

## 1. Verify `RedraftRosterMoveHistory` is in the live composition path

Re-confirmed against the current, committed code (not memory):

```
$ grep -n "loadRedraftRosterMoveRows" lib/decision-os/dashboard-intelligence.ts
40:  loadRedraftRosterMoveRows,        (import)
42:    loadRedraftRosterMoveRows,      (Promise.all composition)
```

`loadRedraftRosterMoveRows` is one of seven sources composed inside `loadLeagueEvents()`, the function used by `resolveManagerIntelligencePayload` — the same, and only, live route (`/api/decision-os/manager-intelligence`) that runs the full Phase 5→6.1→6.2 pipeline. All seven loaders (`loadWaiverClaimRows`, `loadLeagueTradeRows`, `loadRosterMoveRows`, `loadDraftRows`, `loadRedraftTradeRows`, `loadRedraftRosterPlayerRows`, `loadRedraftRosterMoveRows`) are confirmed present in `lib/decision-os/behavioral/port.ts`.

## 2. Verify lineup-history fails safely

Re-ran the existing Phase 2H regression test:

```
__tests__/decision-os/dashboard-intelligence-pipeline.test.ts
  ✓ is degraded-safe when specifically the Phase 2H lineup-history loader fails (missing history fails safely)
```

`resolveManagerIntelligencePayload`'s entire body remains one `try`/`catch` returning `{ managerDna: null, recommendations: null }` on any failure — unchanged by Phase 2H, verified still true for this seventh source specifically. On the write side, `app/api/redraft/roster/route.ts`'s PATCH handler wraps the history-write call in its own `try`/`catch` (confirmed via the existing route-contract test in `__tests__/redraft/lineup-validation.test.ts`), so a history-write failure cannot fail a real lineup save.

## 3. Measure synthetic readiness again versus Phase 2F/2G

New test file: `__tests__/decision-os/phase6/manager-dna-phase2i-combined-readiness.test.ts` (4 tests). Combines all four real redraft signal sources for one synthetic "well-rounded engaged manager" (6 trades, 3 waiver claims, 8 free-agent adds — the exact activity level Phase 2F/2G measured as `'committed_grinder'`, confidence 0.55, completeness 95) and adds real lineup-history on top.

| State | primaryIdentity | confidence | completeness | traits | warnings |
|---|---|---|---|---|---|
| **Phase 2F/2G baseline** (trades+waivers+free-agent only, no lineup-history) | `committed_grinder` | 0.55 | 95 | `active_trade_initiator` (weak) — **a real trait Phase 2F's diagnostic never actually checked, corrected here** | `[]` |
| **Phase 2H/2I** (same activity, + 6 lineup-history saves across weeks 1–6) | **`set_and_forget`** | 0.55 | 95 | `active_trade_initiator` + `set_and_forget_tendency` | `['conflicting_signals: conservative roster pattern alongside trade spike — set_and_forget may understate trade activity']` |

**Why the identity flipped:** with only 6 of the lookback window's ~12.86 weeks having any lineup-history event (real, but this feature just shipped and there is no way to backfill history for weeks before it existed — Phase 2G's own migration-risk note already flagged this), Phase 6.1 detects `conservative_roster_pattern` — "1 streak of consecutive zero-change weeks" — for the remaining, coverage-less weeks. `set_and_forget` is checked at priority 2 in the classifier pipeline (see `lib/decision-os/phase6/dna/dna.ts`'s `CLASSIFIERS` array), ahead of `committed_grinder` at priority 8, so it wins even though the manager's actual trade/waiver/free-agent behavior is genuinely high-engagement.

**One honest mitigating detail:** the system does not silently mislabel — `warnings` explicitly flags the exact conflict (`'set_and_forget may understate trade activity'`), matching Decision OS's honest-disclosure convention. But the *primary identity* a consumer would surface to a user is still the less-accurate one, because classifier priority order doesn't account for this specific conflict beyond the warning.

**A separate isolated test** (4 lineup-history saves concentrated in one real week, same trade/waiver/free-agent activity) confirmed the Phase 2H finding still holds in this richer context: the `lineup_tinkerer` trait fires correctly when genuine same-week clustering exists — that part of Phase 2H's contribution is sound. It's specifically the *sparse-coverage* case (activity concentrated in a few real weeks, silence elsewhere because the feature is new) that produces the misclassification above.

## 4. Is the remaining blocker now only real-world volume evidence?

**No — there are now three distinct categories of remaining concern, only one of which is "just volume":**

1. **Real-world volume evidence** (carried over from Phase 2F/2G, unchanged): still no measured real distribution of trade/waiver/free-agent/lineup-save activity across actual redraft leagues.
2. **NEW — ramp-up misclassification risk** (§3): because lineup-history cannot be backfilled, any manager whose real activity happens to be concentrated in only some of the lookback window's weeks — which will be *every* manager, for as long as this feature has been live less than a full lookback window — risks a `conservative_roster_pattern` false-positive that can override an otherwise-correct, high-engagement identity. This is a genuinely new, more urgent concern than volume: it doesn't go away with more real leagues having data, it only resolves as *elapsed time since deployment* grows past one full lookback window (~90 days by default).
3. **Structural event-type gaps** (confirmed by direct inspection, not previously quantified in this workstream): of the 14 event types in `lib/decision-os/behavioral/events/taxonomy.ts`, only 8 (`lineup_saved`, `trade_created`, `trade_accepted`, `trade_rejected`, `waiver_claim_created`, `waiver_claim_processed`, `draft_started`, `draft_pick_made`) have any real mapper anywhere in the pipeline. `lineup_viewed`, `commissioner_action`, `rules_changed`, `league_opened`, `live_scoring_opened`, and `recap_viewed` have zero real data source — meaning `ManagerActivityRatesInput.loginSessionsPerWeek` is always `0` for every manager (already an acknowledged honest-zero in `dashboard-intelligence.ts`'s own code comment), and engagement-tier computation never sees session/page-view signal at all. This doesn't block the specific scenarios measured in §3, but it's a real, separate gap from "needs more redraft trade/waiver data."

## 5. Should we request a staging read-only volume check now?

**Recommendation: not yet — and this session did not request or perform one.**

Two reasons, both concrete:

1. **`RedraftRosterMoveHistory`'s migration has not been deployed anywhere.** Phase 2H deliberately authored the migration file and regenerated the Prisma Client without running `prisma migrate deploy` (per the "do not connect to any database" constraint that phase operated under). A staging query for this table today would trivially return zero rows — not because real activity is low, but because the table doesn't exist in any deployed environment yet. That's not useful evidence; it would just restate "this hasn't shipped."
2. **Even a perfect volume answer for trades/waivers/free-agent activity (the tables that *are* already live) wouldn't resolve §3/§4's ramp-up finding.** That risk is about *elapsed time since a feature ships*, not about how much real activity exists. Requesting a staging check now would answer the wrong question first.

**What should happen before requesting one:** deploy Phase 2H's migration (a separate, explicit decision — this doc does not request that either, since it's a production-facing action distinct from a read-only query), let real lineup-history accumulate for at least one full lookback window, and *then* a staging volume check becomes meaningful for all four signal types at once. That sequencing is Phase 2J's job, not this session's.

## Go/no-go for AI Coach

**Unchanged: NO-GO.** If anything, this phase raised the bar slightly rather than lowering it — the newly-discovered ramp-up misclassification risk means simply "having the code live" is not sufficient; there's a real, measured failure mode (a correctly-engaged manager's identity flipping to a less-accurate label) that needs either (a) time to age past, or (b) a classifier-priority-order fix that is explicitly out of scope for this data-completeness-focused workstream and should be its own, separately-owned decision.

## 6. Phase 2J implementation prompt

> Phase 2J should not migrate a consumer. Two candidate next steps, pick based on what's actually actionable next:
>
> **(a) Deployment sequencing (if the team is ready to ship Phase 2H's schema):** apply the `20260705000000_add_redraft_roster_move_history` migration to staging (and eventually production) via the normal `db:migrate:deploy` pipeline — a real, production-facing decision that needs its own sign-off, not something to do inside a documentation/verification phase. Once deployed, track elapsed time; do not re-run a lineup-pattern-dependent readiness check until at least one full `INTELLIGENCE_LOOKBACK_DAYS` window (default 90 days) has passed since deployment, per §3/§4's ramp-up finding.
>
> **(b) Classifier priority-order review (if the team wants to address the misclassification risk directly, independent of deployment timing):** scope (do not implement without further review) whether `lib/decision-os/phase6/dna/dna.ts`'s `CLASSIFIERS` priority order should account for the specific conflict already flagged by its own `warnings` array (`conflicting_signals: conservative roster pattern alongside trade spike`) — e.g., should a classifier whose trigger pattern is itself flagged as conflicting with a higher-magnitude signal (like `committed_grinder`'s trade/waiver/engagement score) be demoted rather than winning outright? This touches frozen, shadow-live Decision OS Phase 6 code and needs its own ADR-scoped review before any change, per `ARCHITECTURE_FREEZE.md`'s own governance rule — do not fix this opportunistically inside an unrelated phase.
>
> Do not touch AI Coach, Trade Analyzer, Trade Proposal Generator, Chimmy, or `lib/manager-dna.ts` in either option. Do not request a staging query until (a) has actually happened and the lookback window has elapsed.

## Files changed in this phase

- `__tests__/decision-os/phase6/manager-dna-phase2i-combined-readiness.test.ts` (new — 4 tests)
- `docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md` (this document, new)

No other file was created, modified, or deleted. No database was queried or connected to; staging access was not requested this session.

# User OS Domain Support Matrix

Date: 2026-07-12/13. The honest disclosure table this phase's own brief
requires. Every sub-case from the phase's own "at minimum support" lists is
listed below, classified as one of: **production-wired**, **physically
proven**, **fixture-proven**, **source-verified**, **partial**,
**unsupported**, **stale-data blocked**, **provider-limited**, or
**deferred**.

## Sport coverage

| Sport | Status |
|---|---|
| NFL | **partial** — `lineup`/`waiver` have real, tested logic. `roster`/`trade`/`playoff`/`strategy` are sport-neutral and also real for NFL. |
| NBA, MLB, NHL, soccer, college football, college basketball | **unsupported** for `lineup`/`waiver` (explicit `unavailableDomains` marker, never NFL-shaped logic silently applied). `roster`/`trade`/`playoff`/`strategy` are sport-neutral and *may* produce output for these sports if the league has real standings/roster data — not separately verified per sport this phase, so treat as **source-verified only** for non-NFL sports on those four domains. |

Real, disclosed reason: the phase's own Part 1 inventory found real
sport-specific signals (NBA schedule-density via `GameVolumeService`,
weather via `lib/weather/*`) exist in the codebase but are not wired into
this phase's context assembler — a real, deliberate scoping decision (see
`USER_OS_RECOMMENDATION_ARCHITECTURE.md`), not an oversight.

## Lineup domain

| Sub-case (from the phase brief) | Status |
|---|---|
| Obvious injured-starter alerts | **fixture-proven** — real logic (`generateLineupRecommendations`), tested against representative `UserOsContext` fixtures; not run against a live NFL week's real data this phase. |
| Inactive/suspended starter alerts | **fixture-proven** — covered by the same `isLikelyOut()` status-string match (`out`/`ir`/`suspended`/`doubtful`). |
| Empty lineup slot alerts | **fixture-proven** — real structural check (zero starters with bench/IR present). |
| Projected bench upgrade | **deferred** — see `roster.bench_inefficiency` below; not a lineup-domain recommendation this phase (classified under `roster` instead, since it doesn't change what's "started," only flags the discrepancy). |
| Bye-week replacement | **deferred** — no real bye-week data wired into `UserOsContext` this phase. |
| Higher-projection starter | **deferred** — same underlying signal as bench-upgrade; not emitted as a lineup-domain type this phase. |
| Floor-vs-upside note | **deferred** — no real confidence-interval/variance data available in `RosterPlayerEntry`. |
| Illegal lineup / position mismatch | **deferred** — real `lib/roster-legality/positionEligibility.ts` exists (Part 1 inventory) and is production-wired elsewhere; not re-integrated into this generator this phase. |
| IR activation recommendation | **deferred** — no real "should activate" decision engine was found to exist anywhere in the codebase (Part 1 inventory: real gap, not just unwired). |
| Starter lock-time warning | **deferred** — real `lib/roster-lineup-engine/lineupLockService.ts` exists; not wired into this generator's output this phase. |
| Weather adjustment | **deferred** — real `lib/lineup-actions/weatherLineupSignals.ts` exists (OpenWeather-backed); not wired. |
| Schedule density (multi-game sports) | **unsupported** — lineup domain itself is NFL-only this phase; N/A. |

## Waiver domain

| Sub-case | Status |
|---|---|
| Best available upgrade | **deferred** — requires a real free-agent pool with valuation; not safely assembled this phase (see `waiverRecommendations.ts` header). |
| Positional need pickup | **fixture-proven** — real, implemented as `positional_need` (zero-healthy-players-at-position), without naming a specific player. |
| Injury replacement | **fixture-proven** — same `positional_need` signal is injury-driven. |
| Short-term streamer / long-term stash | **deferred** — requires player-type classification not present in canonical roster data this phase. |
| Breakout/trending pickup | **deferred** — real `CrowdTrendData` exists in `lib/waiver-engine` but Part 1 inventory found it's dead code even in the live waiver engine (never populated). |
| Drop candidate | **deferred** — same free-agent-pool gap. |
| FAAB guidance | **deferred** — real `computeFaabBid` exists and returns a range (not a false-precision number), but its `FaabBidInput`/`FaabContext` need fields (`needFitScore`, `contenderWindowScore`, etc.) this generator does not safely have. |
| Waiver-priority guidance | **unsupported** — Part 1 inventory found waiver-priority (non-FAAB) is itself dead/unused in the existing real waiver engines; nothing to wire. |

## Trade domain

| Sub-case | Status |
|---|---|
| Incoming trade evaluation | **N/A this generator** — requires a user-submitted two-sided trade; the real `/api/dynasty-trade-analyzer`/`/api/trade-value/analyze` routes remain the entry point (unchanged, production-wired per Part 1 inventory). |
| Buy-low / sell-high / position-of-need / surplus targets, realistic partner identification, proposal generation | **deferred, pointer only** — this generator emits a real, honest CTA (`buy_low_posture`/`sell_high_posture`) framed by the real `strategy` classification, linking to `/trade-finder` (real, production-wired, per inventory) rather than fabricating player-level trade math this generator has no safe way to compute (`TradeDecisionContextV1` assembly deliberately not attempted — see file header). |
| Acceptance probability | **deferred** — real `computeDeterministicVerdict` returns this, but only when given a fully-assembled `TradeDecisionContextV1`; not called this phase. |
| Contender/rebuild-specific moves | **fixture-proven** — the posture framing (buy-low vs. sell-high) IS contender/rebuild-aware, driven by the real `strategy` domain classification. |

## Roster domain

| Sub-case | Status |
|---|---|
| Position weakness | **fixture-proven** — real count-based heuristic (exactly 1 rostered player at a position on an 8+ player roster). |
| Position surplus | **deferred** — not implemented this phase (weakness only). |
| Age concentration | **unsupported** — no player-age field in canonical `RosterPlayerEntry`; real dynasty-age logic (`lib/dynasty-engine/AgingCurveService.ts`) exists but is dynasty-only and not wired here, matching the explicit guardrail against applying dynasty logic to redraft. |
| Injury concentration | **fixture-proven** — real count (3+ players with a live out/doubtful/IR/suspended status). |
| Bye-week concentration | **deferred** — no real bye-week data wired this phase. |
| Bench inefficiency | **fixture-proven** — real same-position projection comparison (bench > starter). |
| Shallow depth / excessive duplication / unbalanced construction | **deferred** — not implemented this phase beyond the single-player-at-position weakness case. |
| Underused IR/taxi slots | **deferred**. |
| Future-pick weakness/strength | **unsupported** — no draft-pick data in canonical roster context this phase; real `lib/dynasty-projection/DraftPickValueModel.ts` exists, dynasty-only, not wired. |
| Replacement-level roster spots | **deferred**. |

## Strategy domain (contender/retool/rebuild)

| Sub-case | Status |
|---|---|
| Strong contender / contender / fringe contender / retool / rebuild / insufficient-evidence outputs | **fixture-proven** — all six real, deterministic outcomes from `classifyStrategy()`, driven by real win%/standing-percentile/season-week. |
| Redraft-specific language (push for playoffs / hold / aggressively improve / retool) | **fixture-proven** — verified never to say "rebuild" for a redraft league. |
| Dynasty-specific rebuild framing | **fixture-proven** — verified to allow "rebuild" only when `League.isDynasty` is real and true. |
| Inputs beyond record/standing (roster value, future assets, schedule difficulty, injury load) | **deferred** — this phase's classifier uses real record + league-standing percentile + season week only; the richer multi-factor version described in the brief is a real, disclosed scoping cut, not a hidden gap. |

## Playoff-path domain

| Sub-case | Status |
|---|---|
| Current playoff probability | **fixture-proven** when a fresh `SeasonForecastSnapshot` exists; **stale-data blocked** (falls back to the qualitative path) when the snapshot is more than 2 weeks old. |
| Remaining schedule difficulty | **unsupported** — not computed this phase. |
| Projected seed | **fixture-proven** — read directly from the real snapshot's `expectedFinalSeed` when fresh. |
| Must-win matchups, tiebreaker risk, position-level point deficit, expected wins needed, likely final-spot competitors | **deferred** — not implemented this phase. |
| Recommended actions to improve playoff probability | **deferred** — the qualitative fallback states position, not a prescriptive action list. |
| Real playoff settings (never assuming 6 teams/standard seeding) | **fixture-proven** — verified via a dedicated test using a real 2-team `playoffTeams` league. |
| Numeric probability marked unavailable when unsafe | **fixture-proven** — verified: no `playoffTeams` setting at all → empty result, never a fabricated number. |

## Prioritization (Part 11)

`selectTopActions()` — **fixture-proven**: at most one recommendation per
domain, highest-priority first, verified by a dedicated test.

## Chimmy seam (Part 17)

`getChimmyUserOsSummary()` — **fixture-proven** access control (a
non-member gets `null`); **not wired into `lib/chimmy-context/*`** this
phase, per the explicit instruction not to rewrite Chimmy yet.

# Commissioner OS Domain Support Matrix

Date: 2026-07-13. The honest disclosure table this phase's own brief
requires. Every sub-case is classified as one of: **production-wired**,
**physically proven**, **fixture-proven**, **source-verified**,
**partial**, **unsupported**, **provider-limited**, **stale-data
blocked**, **commissioner-only**, or **deferred**.

## Authorization boundary

| Sub-case | Status |
|---|---|
| Native AllFantasy commissioner (owner) | **physically proven** — real disposable-branch fixture + unit test |
| Sleeper commissioner (`LeagueTeam.isCommissioner`) | **physically proven** |
| ESPN/MFL/Yahoo attested commissioner | **physically proven** — the real gap this phase closed; verified against a real ESPN fixture on the disposable Neon branch |
| Fantrax attested commissioner | **physically proven** — also confirms `isSnapshotOnly` |
| Normal manager rejection | **physically proven** — real fixture, real `accessDenied: true` |
| Cross-user rejection | **physically proven** |
| Revoked/mismatched attestation rejection | **fixture-proven** (unit test) |
| Nonexistent-league / protected-league non-leak | **physically proven** — byte-identical denial shape confirmed via real API-route test and the disposable-branch script |
| Client-supplied commissioner flag never trusted | **production-wired** — the coordinator's only inputs are session-derived `appUserId` and route-derived `canonicalLeagueId`, structurally verified (no field exists to override it) |

## League Health domain

| Sub-case | Status |
|---|---|
| Overall score, health band, component evidence | **production-wired** — reused directly from `monitorLeagueHealth()` via the pre-existing shared service, never recomputed |
| Trend, confidence | **production-wired** — same source |
| Major risks, strongest areas | **partial** — surfaced via `health.issues`/`health.evidence` text, not a separately-modeled structured list this phase |
| Recommended interventions | **fixture-proven** — one recommendation per health assessment, priority mapped from the real category |
| Never fabricates chat/sentiment metrics | **production-wired** — this phase's generator never reads or invents any chat/sentiment field; none exists in the real context |
| Physically differs between a healthy and a low-activity league | **physically proven** (Part 21) |

## Engagement domain

| Sub-case | Status |
|---|---|
| Real attention-signal-backed recommendations | **production-wired** — `deriveLeagueAttentionSignals()`, previously unconsumed, now has its first real caller |
| Real Mission Control recommended actions | **production-wired** |
| Publish recap / rivalry-week / playoff-race poll / spotlight / milestone / trade-deadline / rule explanation / vote / rematch highlight (as named types) | **deferred** — this phase surfaces real attention items and Mission Control actions generically; it does not synthesize each named engagement-type individually this phase |
| Never recommends artificial engagement | **production-wired** — verified: zero attention items and zero Mission Control actions → zero engagement recommendations, never a generic filler suggestion |
| Suppressed for a snapshot-only league (activity-trend claims only) | **fixture-proven + physically proven** |

## Rankings domain

| Sub-case | Status |
|---|---|
| Weekly power rankings summary, rank movement | **production-wired** — reuses `computePowerRankings()` via the pre-existing shared service |
| Honest specialty-format decline | **fixture-proven** — verified: `specialty_adapter_required` → zero recommendations, never a stub presented as real |
| Standings/roster-strength/dynasty-value/future-assets/manager-efficiency/draft-performance/trade-performance/waiver-performance rankings | **unsupported** — only power rankings are wired this phase; the others have no real, ready engine this generator safely calls |
| Never uses a Sleeper roster id as canonical manager identity | **fixture-proven** |
| Rankings migration not begun | **deferred, by explicit guardrail** |

## Storylines domain

| Sub-case | Status |
|---|---|
| Deterministic candidate detection (streaks, upsets, comebacks, etc.) | **production-wired** — real `DramaEventDetector.ts`, this phase only reads its already-persisted output |
| Copy-ready formats (league chat, Discord, social) | **production-wired** — template-based, grounded in real headline/summary text |
| NFL-only this phase | **provider-limited** (sport-limited) — `storylines_weekly_cadence` marks non-NFL leagues unavailable |
| Never auto-publishes | **production-wired** — no send/publish action exists anywhere in this code path |
| Zero real drama events this season (NFL league) | **not marked `unsupported`** — reports `ok` with an empty list; see the note below |

**Note on the storylines/rivalries/draft asymmetry**, surfaced by Part 21's
real physical validation: `rivalries`/`draft` map "zero real rows" to
`unsupported` (a genuine capability gap — a league either has recorded
rivalry history or a graded draft, or it structurally doesn't). Storylines
deliberately does not — drama detection is a recurring, per-week scan, and
zero rows most weeks is the ordinary, expected steady state ("nothing
dramatic happened"), not a capability gap. Evaluated explicitly this phase,
not blindly made consistent with the other two; see the comment in
`commissionerOsRecommendations.ts`.

## Rivalries domain

| Sub-case | Status |
|---|---|
| Real history-based score/tier/explanation | **production-wired** — reuses `lib/rivalry-engine/` (canonical, manager-id-keyed), never the legacy `lib/rivalry-engine.ts` duplicate |
| Historical confidence marking (`complete`/`partial`/`unknown`) | **production-wired** — real `eventCount` from a fixed `_count` bug (see `COMMISSIONER_OS_CONTEXT_CONTRACT.md`) |
| Never fabricates a rivalry from this week's matchup alone | **production-wired** — `rivalries_history` unavailable marker suppresses the whole domain when `RivalryRecord` has zero rows |
| Top-3 by score, copy-ready | **fixture-proven** |
| Physically differs with real history present vs. absent | **physically proven** (Part 21) |

## Draft & Trade Grades domain

| Sub-case | Status |
|---|---|
| Team grades, league-wide best/worst | **production-wired** — reuses `lib/rankings-engine/draft-grades.ts`'s real, persisted `DraftGrade` rows |
| Format-naive limitation disclosed in the generated copy | **production-wired** — verified via a dedicated test |
| Best value / biggest reach / positional run / surprise pick | **unsupported** — the richer reach/value engine (`lib/live-draft-brain/post-draft-grade.ts::gradeTeamDraft`) is confirmed orphaned (zero real callers); not revived this phase |
| Hindsight-labeled historical grading | **N/A this phase** — this generator only ever reports the real, already-persisted grade for the current season; it never recomputes a past draft |
| Real trade count recap, CTA to Trade Analyzer | **production-wired** |
| Fair-trade grade / roster-impact / veto-risk / neutral recap | **unsupported** — same reasoning as the User OS trade domain: hand-constructing `TradeDecisionContextV1` was judged unsafe this phase's budget |
| Never recommends intervention for a merely-uneven trade | **production-wired** — `governanceSeverity: 'none'` is unconditional in this generator |

## Integrity & Commissioner Actions domain

| Sub-case | Status |
|---|---|
| Inactive-lineup / abandoned-roster review prompts | **production-wired** — real, keyword-filtered reframing of `health.issues` text |
| Cautious, non-accusatory language | **production-wired** — verified: no "confirmed" language, always "Review recommended" |
| Never calls tanking/collusion detection | **production-wired** — deliberate, matches the shared-services package's own documented architectural exclusion |
| Suppressed entirely for a snapshot-only league | **production-wired + physically proven** |
| Human-review flag on every real concern | **production-wired** |
| Repeated one-sided trades, illegal roster construction, ineligible players | **unsupported** — no real signal for these wired into this generator this phase |

## Prioritization

`selectTopCommissionerActions()` — **fixture-proven**: real
`HOMEPAGE_ORDER` map verified via a dedicated test (a critical governance
issue outranks a plain league-health score of the same or higher raw
priority).

## Chimmy seam

`getChimmyCommissionerOsSummary()` — **fixture-proven** access control (a
normal manager and a cross-user stranger both get `null`); **not wired
into `lib/chimmy-context/*`** this phase, per the explicit instruction not
to rewrite Chimmy yet.

## Multi-sport

| Sport | Status |
|---|---|
| NFL | **partial** — `storylines` fully real for this sport; every other domain is sport-neutral and real for NFL. |
| NBA, MLB, NHL, soccer, college football, college basketball | `health`/`engagement`/`rankings`/`rivalries`/`draft`/`trades`/`integrity` are sport-neutral and **source-verified only** for non-NFL sports (not separately fixture-tested per sport this phase). `storylines` is explicitly **unsupported** (`storylines_weekly_cadence`). |

# Commissioner Truthfulness Audit (Phase 34, Track B)

For every Commissioner recommendation: freshness, confidence, missing data, unavailable data, approximation, fallback mode — and any overstatement of certainty.

## What is already honest (verified, not assumed)

- **`CommissionerRankingService.ts`** — refuses to call confirmed-stub engines for best_ball/keeper formats, returning `specialty_adapter_required` with a real explanation rather than presenting stub output as real. Confirmed via real execution: also correctly returns `null` (not a fabricated ranking) when the underlying engine has no real standings data.
- **`CommissionerNarrativeAdapter.ts`** — always computes a deterministic fallback text first; AI-generated text only replaces it when `useAi: true` is explicitly passed AND the AI call succeeds (`result.source === 'ai'`). `aiGenerated` is never silently set true on a failed/degraded AI call — verified in the code, not just claimed.
- **`CommissionerAttentionService.ts`** — hardcodes `financialStatus: 'UNKNOWN'`/`draftDateUtc: null` rather than fabricating values, and this is disclosed in its own comments, verified true in the code.
- **`CommissionerAuthorization.ts`** — discloses that imported-league commissioner identity is self-attested, not independently re-verified — a real, open gap, honestly stated rather than silently assumed safe.
- **Real execution (Track B4) confirmed the module's "fails safe" design holds**: when `lib/decision-os/*`'s backing tables didn't exist in the schema at all, the module caught every resulting error non-fatally and still returned a usable, non-crashing result — a genuine truthfulness-adjacent reliability property (a crash would be worse than an honest degraded result, and it didn't crash).

## Findings

### Finding 1 (MEDIUM, disclosed not fixed — audit-only phase): `LeaguePulseService.ts`'s composite score may overstate its own reusability

The file's header comment claims "no new scoring formula is invented." Verified: every one of the 7 per-dimension scores IS genuinely reused from real Mission Control/League Analytics fields. But the **composite** (bucket-average across the 7 dimensions: `good=90/watch=60/attention_required=30/unavailable=0`) is itself new arithmetic — not sourced from any external engine. This isn't a fabricated number (it's a transparent average of real inputs), but the doc comment's "no new formula" framing slightly overstates how much of the module is pure pass-through versus original aggregation logic. Low real-world impact since the module has zero consumers today, but worth correcting the comment if this module is ever activated.

### Finding 2 (LOW-MEDIUM, needs further investigation, not confirmed as a bug): identical composite pulse score across two different real leagues

Both real leagues tested returned `pulse.compositeScore: 65`, despite different `attentionItems.length` (2 vs 3) and different real underlying data. This MAY be an honest coincidence (both leagues landing on similar dimension buckets given the same missing `decision_os_*` tables and empty `FantasyStanding`), or it MAY indicate the pulse score isn't actually differentiating leagues meaningfully when Decision OS's backing data is degraded — which would itself be a truthfulness concern (a score that looks precise/measured but is actually driven mostly by a shared default). **Not confirmed either way this phase** — flagged honestly as an open question, not asserted as a defect, consistent with the guardrail to distinguish observed facts from inferences.

### Finding 3 (LOW, real but out of this module's scope): Decision OS's backing tables are absent from the schema

`decision_os_imported_activity`, `decision_os_behavioral_snapshot`, `decision_os_league_context` don't exist in `.env.test`. Any Commissioner (or other) surface relying on `lib/decision-os/*`'s full real behavior is running in a silently degraded mode in this specific environment. This is a `lib/decision-os/*` schema/migration issue, not something `lib/shared-services/commissioner/` introduced or can fix — flagged for whoever owns that migration.

## No high-severity findings this phase

Unlike Track A's Matchup Center bug, no confirmed high-severity truthfulness defect was found in `lib/shared-services/commissioner/` itself. Per the guardrail ("do not implement fixes yet unless a critical production defect is discovered"), none of the findings above rise to that bar — all are disclosed for a future, targeted phase.

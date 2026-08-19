# Commissioner OS Content Policy

Date: 2026-07-13. The safety/truthfulness rules this phase's generators and
UI are built against — every rule below is enforced in code, not just
documented intent, with a pointer to where.

## Never fabricate

- **League history** — `championHistory`/`rivalries` are read-only from
  real `LeagueSeason`/`RivalryRecord`/`RivalryEvent` rows; empty when no
  history exists, never invented (`commissionerOsContext.ts`).
- **Manager activity** — `engagementRecommendations.ts` only surfaces real
  `CommissionerAttentionItem`s and real Mission Control recommended
  actions; zero of either produces zero recommendations, never a generic
  "engage your league!" filler.
- **Rankings** — `rankingsRecommendations.ts` returns nothing rather than
  present a `specialty_adapter_required` stub as real.
- **Rivalries** — suppressed entirely (`rivalries_history` unavailable)
  when `RivalryRecord` has zero rows; never inferred from "these two teams
  are playing this week."
- **Draft/trade grades** — read-only from real `DraftGrade` rows / real
  Mission Control trade counts; never recomputed or estimated by this
  generator layer.

## Never automatically publish

No generator, no UI action, and no API route in this phase's code path
sends, posts, or publishes anything. Every `CopyReadyContent` entry is
preview-only (`CommissionerOsActionsSummary.tsx`'s copy-ready panel: preview
→ edit → copy-to-clipboard → dismiss; "Refresh" re-fetches from the real
coordinator, it is not a "regenerate and send" action). No `action.href`
in any generator points at a send/publish endpoint — the trade-grade
generator's CTA, for example, links to `/dynasty-trade-analyzer` (a real
read surface), never a send action.

## Never accuse without strong evidence

`integrityRecommendations.ts` never calls
`lib/integrity/TankingDetectionEngine.ts` or `CollusionDetectionEngine.ts`
— both have real deterministic-evidence layers but an LLM-adjudicated
final verdict, and the shared-services package's own README already
documents excluding them from deterministic aggregation for architectural-
purity reasons. This generator instead reframes real, already-verified
`health.issues` text with the phase brief's own required cautious
language: title is always literally `"Review recommended"`, summary is
always prefixed `"Possible integrity concern: ..."`,
`governanceSeverity` is `'review_recommended'` (never
`'rule_violation_confirmed'`), and `humanReviewRequired` is always `true`.
Verified by a dedicated test that the summary text never contains
"confirmed."

## Never recommend intervention for a merely-uneven trade

`tradeGradeRecommendations.ts` hardcodes `governanceSeverity: 'none'` and
`humanReviewRequired: false` unconditionally — there is no code path in
this generator that can flag a trade for review based on valuation alone.
Real rule violations, fraud, collusion, or invalid ownership are the
integrity domain's job, with its own separate, cautious-language generator.

## Never expose private manager data in public copy

Every `CopyReadyContent` entry is built from `buildCopyReadyContent()`
(`copyReadyContent.ts`), which only ever receives a real `headline`/
`summary` already computed by a real engine (`DramaEvent`, `RivalryRecord`,
power rankings) — none of which include raw contact info, private
retention-risk scores, or behavioral-profile detail. `publicationAudience`
is set per-recommendation (`commissioner_only` for engagement/health/
integrity/trade-recap items with `humanReviewRequired`, `league_wide` only
for storyline/rivalry/draft-grade copy that's already grounded in public
league facts).

## Never claim Fantrax CSV is live

`CommissionerOsContext.isSnapshotOnly` is `true` only for Fantrax
(`csv_snapshot`, via the existing, real `deriveImportType()`). When true:

- The `integrity` generator returns nothing at all — a one-time upload can
  prove a lineup's state at upload time, never a repeated or ongoing
  pattern (abandonment, inactivity).
- The `engagement` generator suppresses any `manager_engagement_risk` item
  ("this team has gone inactive" is itself an ongoing-pattern claim) while
  still surfacing non-activity-trend items (e.g. a real scoring-settings
  review flag) normally.

Both behaviors are covered by dedicated tests and were re-verified against
a real Fantrax-platform fixture on the disposable Neon branch in Part 21.

## Never assume NFL formats for every sport

`storylines_weekly_cadence` marks the storylines domain unavailable for
any non-NFL sport (`commissionerOsContext.ts`) rather than silently
applying NFL-shaped weekly-cadence logic to a daily-cadence sport.

## Never use "AI" in customer-facing naming

No generator, UI component, or doc in this phase's deliverables uses the
word "AI" in any customer-facing string. Product-facing vocabulary used
instead: "Commissioner OS," "Commissioner Assist" (implied by the widget's
own header, "Commissioner OS"), "League Intelligence," "Weekly Brief"
(reused from the pre-existing `CommissionerBrief` naming). Verified by
reading every generated `title`/`summary`/copy-ready template string in
this phase's code.

# Chimmy own-team comparisons

Questions such as “Which league do I have the most complete team?” now resolve the
user's memberships before reading rosters and produce an engine-backed comparison.
An explicit account-wide question overrides the drawer's selected league. Named
leagues, ordinal follow-ups, horizon changes and scoped upgrade questions retain
their reference state; every reference is re-authorized on the next request.

## Evidence and behavior

- Weekly strength uses shared league component scoring and lineup filling. Season
  and dynasty roster value reuse My Team's league-relative roster ranking.
- The disclosed construction index uses 50% strength percentile, 30% weakest-position
  percentile and 20% position-eligible backup coverage. Missing components, partial
  identities or stale rosters prevent a complete construction score.
- Verified structure remains useful when values are unavailable: the answer explicitly
  limits itself to slot coverage and depth. Sports are compared separately. Dynasty
  scores exclude picks and contract costs; season roster value is not a ROS points forecast.
- Injury exposure counts verified own holdings. A missing or stale injury report is
  never interpreted as health. Championship questions use the Season Outlook simulator
  and its supported formats; unsupported probabilities are withheld.
- Both chat surfaces render coverage, source dates, per-team metrics and gaps, and
  scoped next-step controls. Clicking a follow-up fills the composer without submitting.
  Analysis refresh is an authenticated, rate-limited read of stored data, not a provider sync.
- Snapshot reuse is user/horizon/version-specific, coalesces concurrent reads, expires
  after 15 seconds, and rechecks membership and league/roster versions. A failed version
  read disables caching. Refresh bypasses reuse.
- Reads have wall-clock and concurrency bounds. Up to 40 teams are displayed per pass;
  unchecked teams have an explicit continuation. Undrafted, unclaimed, empty, stale and
  unreadable teams are distinct states. Active seasons are selected per league, not by
  the newest season of an unrelated league in the same sport.

## Billing and telemetry

Blocked comparisons return before token spending or allowance consumption. Successful
comparisons use the existing preview, consent, receipt and allowance paths, and return
before any model generates a competing verdict. A tool-loop comparison blocked by
missing context participates in the existing undelivered-answer refund settlement.

Question telemetry distinguishes `needs_context` and `partial_answer` from `answered`.
It stores tool and outcome metadata without raw questions or roster contents. Private
history stores validated comparison evidence and scope hints for transcript restoration.

## Verification

The focused release suite covers question variants, exact membership boundaries,
ordinal references after membership removal, active/historical seasons, provider ID
namespaces, native league freshness, best-ball behavior, weekly scoring coverage,
timeouts, cache invalidation, paging, context-blocked billing, history replay, and both
chat interfaces. It passes 190 tests across 11 files.

A local browser fixture using the production card and Tailwind passes at 320, 390,
and 1280 px: no horizontal overflow or page errors, correct scoped prompts, horizon
changes, analysis refresh, expansion and no request/spend on an action click. This
fixture does not call a live model or impersonate a production account.

Focused TypeScript validation reports no errors in changed production files. Existing
dependency/schema errors with the shared local Prisma client remain outside this change;
the repository CI regenerates Prisma and applies its normal TypeScript and unit ratchets.

## Release and rollback

No schema or environment-variable changes are required. Merge the isolated PR after
required checks, let the `main` Railway service build, then verify `/api/health`, the
served commit and anonymous access boundaries. Observe the production service for
new chat errors, unexpected context refusals or billing failures. Roll back by reverting
the release commit through the same workflow if those regress; do not alter league data.

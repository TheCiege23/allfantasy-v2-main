# Bracket experience release acceptance

## Delivery scope

Follow-up to PR #3138, carried on PR #3149. Adds a private points ledger and observed change history, a first-entry checklist, opt-in pool alerts, provisional live standings, and complete English/Spanish text for the new companion, factual evidence and scenarios.

Official points still use the sport's existing scorer. A live lead never writes points, winners or qualifiers. Group-play wins remain one point in NBA Cup. Pool rank and universal rank remain distinct.

## Release gates

1. Required checks must pass at the exact pushed head. No baseline updates, force pushes or protection changes.
2. Railway production deployment must be SUCCESS, with runtime startup evidence. Record its exact commit and prove that it contains this PR's actual merge commit. A newer main deployment may contain it; a removed superseded build is not a failure.
3. Run the credential-free verifier only after that deployment succeeds:

   `node scripts/verify-bracket-release.mjs https://www.allfantasy.ai POOL_ID DEPLOYED_SHA ACTUAL_MERGE_SHA`

   This checks ancestry, health, public Cup feed, the private coach's authentication boundary and public-feed privacy. It performs GET requests only and prints minimal booleans/counts. It cannot verify a user's signed-in journey or prove that a live game has already occurred.
4. Inspect the existing Railway bracket scheduler's structured log attributes: `experience.processed`, `experience.alerts`, `experience.failures`. The existing authenticated cron runs the experience sweep after the result sync; no new production schedule or variable is required. No browser read invokes the publisher or the sweep. Alert checks run on the existing schedule, not a hard real-time delivery guarantee.

## Authenticated acceptance in an isolated environment

Use a designated QA account and fixture pool with a future game, live game, verified final and pending knockout slot. Do not use the owner's real NBA Cup entry, copy cookies, or request passwords.

- Join through the normal invitation flow. Create an entry explicitly. Verify the checklist has one pending slot and does not call it a missing selectable pick.
- Save one pick through the normal UI. Reload and confirm it persists while the checklist still says it must be finalized. There must be no automatic finalization.
- Complete all available picks, enter the normal championship tiebreaker, then explicitly finalize. Reload and confirm the original finalization timestamp persists. Check My Brackets and the entry link.
- A later confirmed upcoming game may be selected; a started game must reject a save through the server, even if a stale browser still shows an open button.
- Inspect the points ledger: group correct +1, incorrect +0, draft/late +0. Sum the explanation and compare with canonical official total. A transient mismatch is displayed, never silently corrected by this UI.
- Let the scheduled worker observe the fixture. A first snapshot establishes the baseline and sends no old-result notifications. Publish a new verified final through the isolated fixture's normal result pipeline; the next observation must add one settlement event. Rechecking must add no duplicate. An authorized fixture correction must show before/after scores and points, including zero-point corrections.
- Compare two finalized entries with differing **locked** picks. A fresh live lead may change the hypothetical rank; a tied or >120-second-old feed must not add live points. Drafts and future rival picks must remain private. When final, compare league and universal score/potential/correct counts, with their independent ranks.
- On alerts: verify default off; explicitly opt in and save. Reload to confirm persistence. Check missing picks, locks, finals and official-rank options, lead time, spoiler setting, channel settings, quiet hours and device subscription. Opt-out must suppress future dispatch and queued transport retries. Failed delivery must retain the same dedupe identity. SMS is excluded for these new alerts.
- On Chimmy: free facts must not spend tokens or call an AI provider. Real analysis must use existing coaching entitlement, signed token confirmation when required, global spend guard, and existing refund/nondelivery behavior. Test cancellation, price change, retry, provider failure and missing evidence in the isolated environment. A recommendation changes no pick until a separate user action, and never finalizes.
- Switch English/Spanish during an in-flight request. Old-language results must not overwrite the new language. Check deterministic facts, injury labels, qualification roads, calendars, score explanations and alerts in both languages.
- At 390px and 1440px, exercise every companion tab, ledger filter/pagination, reminder download and alert form by mouse and keyboard. Tables scroll within their region; the page does not overflow.

## History, notification and scale limits

- History is an observation log, not a financial or immutable audit ledger. It records changes after the first scheduled snapshot, with observation timestamps and before/after values. It does not backfill unknown earlier corrections. Per-entry snapshots retain the most recent 200 changes and show the number removed; storage expires no earlier than January of season + 2. The current per-game explanation remains visible without a saved history.
- History and alert state live in the existing `SportsDataCache` JSON store under a versioned namespace; preferences live in the existing profile JSON. No schema migration. Cleanup of expired cache rows also clears expired history; do not claim permanent retention.
- The sweep rotates through 100 entries across at most six pools per call. Larger populations take multiple calls; delivery has no before-tipoff SLA. One canonical pool view is reused per batch. Entry observation uses transaction advisory locks; notification transport uses existing durable idempotent outbox and retries. Saved preferences use optimistic concurrency so other profile/pool settings are retained.
- Scheduled history and alerts cover NBA Cup and CFP; CFP also requires its pre-existing result-sync opt-in. Other playoff sports retain the current per-game points explanation without offering an alert switch that has no worker. No CFP opt-in or production setting was changed by this work.
- Spoiler-safe summaries are the default. No opponent picks, personal pick values, or private league names are sent in notification text. Device subscription and existing global/category/quiet-hour policies still apply. Opting into this pool does not turn on globally disabled channels.
- Automated fixture tests and mocked billing/provider tests do not equal authenticated production acceptance. Never mark the complete production journey passed until the above receipts exist.

## Design references

- [NBA Cup format and official qualification rules](https://www.nba.com/news/nba-cup-101): do not invent unknown qualifiers or unavailable tiebreak inputs.
- [MDN notification permission guidance](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API): browser permission requires a user action and a secure context. This feature reuses the existing notification subscription/settings flow.

# Refresh, scoring and nested workflow audit — October 4, 2026

## Scope and evidence

Source audit based on main `ffd35a7bf13f689dea94feb30330740d9192d371`, with isolated changes. No production claims, picks, settings, notifications or trades were submitted. Tests use mocked providers and database writes, with the repository's database guard enabled.

179 selected tests passed across refresh continuation, score ingestion, public/core live polling, conditional live responses, live points scheduling, game views, waiver advice, commissioner actions/settings, notification scoping/muting, portfolio deduplication and draft submission/race/role contracts. The new live request races reproduced six failures before fixes; nested waiver regressions reproduced scope and action failures before fixes. TypeScript ratchet result is recorded in the release status/PR after completion; no baseline changes are authorized by this audit.

## Reproduced and fixed

| Priority | Gap | Change |
| --- | --- | --- |
| P1 | Invalid attempted counts, expanding continuation scopes and overflowing totals can repeat provider work or falsify progress. | Validate counts and scope before accepting progress; preserve prior verified totals on invalid responses. |
| P1 | A verified incomplete sync clears its remaining-work checkpoint; pressing again refreshes completed leagues. | Preserve confirmed remaining keys and cumulative totals; retry only that scope. An unverified/network failure still clears automatic retry state and tells the user to check status. |
| P1 | Old HTTP/network failures or 304 responses can change the connection badge after a view switch. | Sequence-guard every result path in both core and public live clients; bound each request to 15 seconds. Last verified data and its fetchedAt remain intact on failure. |
| P1 | Negative-only Sleeper scoring is treated as unplayed; an all-zero correction leaves previous points stored. | Accept nonzero negative scores. Apply zero corrections only when the same provider league/season/week/roster already has recorded scoring; future placeholder weeks still create no scores. |
| P1 | Booleans, arrays and whitespace coerce into invented score values. | Validate numeric values and reject array-shaped player score maps. |
| P1 | Waiver results from another league remain displayed, including late responses. | Key the panel by league, disregard responses after unmount and prevent duplicate analysis requests. |
| P1 | A malformed successful advice response clears verified suggestions as if there were no targets. | Require an explicit successful response and recommendation array; keep prior advice on unverifiable refreshes. |
| P0 | Unknown/malformed commissioner waiver actions fall through to roster-changing processing. | Reject invalid JSON, non-object payloads and unknown actions before calling the processor. Both clients now send action=process. Empty/no-body legacy manual-run requests remain supported. Commissioner authorization runs before action processing. |
| P2 | A malformed waiver history limit reaches storage as NaN or a fraction. | Normalize finite integer limits with the existing 1–100 bound and default 50. |

Scores remain source-platform values; the writer does not derive custom league fantasy points. Sleeper's documented matchup total is based on league settings: https://docs.sleeper.com/#getting-matchups-in-a-league . The player-point wire extension is already used by the existing integration and is covered by runtime validation/tests rather than claimed as documented there.

## Production read-only score checks

Public `/api/dashboard/live-scores?view=live&sport=NFL&scope=all` was compared to ESPN's NFL scoreboard for October 4. Fourteen games matched by ESPN event ID. Scheduled games correctly withhold pregame 0–0 placeholders.

The active game `401872965` matched at both polls:

| Payload fetchedAt UTC | AllFantasy home–away | ESPN home–away | State |
| --- | --- | --- | --- |
| 2026-10-04 14:09:11.050 | 6–0 | 6–0 | In progress |
| 2026-10-04 14:11:15.315 | 6–0 | 6–0 | In progress |

This verifies the public scoreboard's source agreement and advancing freshness, not a score-changing event, personalized fantasy totals or signed-in browser rendering. A read-only score-table query was blocked because the Neon connector returned `Unknown tool (neon.run_sql)`.

## Nested workflow audit

| Workflow | Reviewed/verified | Remaining gap |
| --- | --- | --- |
| Waivers | Imported/native handoff distinction; null FAAB disclosure; advice scope; server account/role boundaries; commissioner processor invocation. | Add a complete settings request schema for negative/fractional limits, invalid times/dates and configuration objects before upsert. Live claim execution was not tested. |
| Drafts | Session and draft membership helpers; existing pick submission, commissioner-order and concurrent-pick lockout tests passed. | Full signed-in draft/reconnect/auction/keeper flows require browser access; not all draft endpoints were exercised. |
| Commissioner | Hub gate and grant-scoped reports; waiver role gate and actions; claim override league/status lookup. | Claim override validation and pending-status atomic update deserve a separate review. Imported-provider capabilities must be checked during signed-in use. |
| Portfolio | Claimed-team scope; provider ID+season deduplication; tests passed. | Freshness and partial provider failures still need signed-in display checks. |
| Settings | Previous serialized league preferences fix reviewed; waiver settings edit permission fetch and save path inspected. | Waiver settings form should reset editing state on league changes and reject incomplete/malformed settings responses. |
| Notifications | Account/league read scope and mute preference protection tests passed. | In-flight mark-read responses on league/account switch and settings PUT preference-read validation need targeted review; signed-in delivery not certified. |

## Additional scoring/recovery follow-ups

- P1: `refreshLiveSleeperPoints` skips when no live NFL games exist; the game view stops polling at final. Define and implement bounded post-final correction refreshes so the last game of a slate cannot leave stale corrections until ordinary sync. This audit fixes acceptance of corrections when ingestion runs, not the correction schedule.
- P1: Bind persisted sync checkpoints and shared browser job state to the signed-in account. The server currently rechecks ownership, but client counts/checkpoints are not account-keyed.
- P2: Validate each recommendation row, not only the response envelope/array, before rendering.

Signed-in browser runtime remains blocked by Windows sandbox `apply deny-read ACLs` after restart. Physical device checks and signed-in refresh/recovery, personalized live fantasy totals and complete nested flows remain unverified.

## Follow-up implementation — October 4

The post-final schedule, account isolation, settings validation and recommendation-row items above are now implemented in the follow-up patch:

- The points cron includes stored live/final NFL games from either provider within eight hours of kickoff. Existing two-minute cadence, rotating league slice and time budget remain enforced. This catches early final corrections; later corrections still rely on ordinary sync.
- Final game views make ten checks at two-minute intervals, then stop; each request has a fifteen-second budget.
- The session provider supplies the authenticated account to sync controls. Checkpoints use an account-specific v2 key; old unbound checkpoints are discarded. Account changes abort production requests and invalidate late results, progress and continuation before a new job starts.
- Commissioner settings PUT validates nonnegative integer limits, weekdays, UTC times, dates, rule objects and known engine values before storage. Omitted overrides retain existing values; explicit zero/null remain supported.
- Settings panels remount on league changes, verify configuration and permission/save responses, ignore late saves and report unconfirmed saves for recovery.
- Recommendation rows validate display values and local analysis paths, preserving verified advice on malformed refreshes.

The original PR's TypeScript and Playwright gates passed. Its unit ratchet found one newly failing layout fixture that omitted the required API success flag; the fixture now matches the response contract. No failure baseline was relaxed. Signed-in/device verification and commissioner claim-override/notification race follow-ups remain outstanding.

Follow-up verification: 235 tests passed across 24 selected files on the published PR base, including original correctness coverage and English/Spanish sync regressions. Five focused settings scope/recovery tests also passed, including late-save and malformed-success handling. Required CI is restarted for the updated commit; these local results do not certify production or physical devices.

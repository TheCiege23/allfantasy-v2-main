# Zombie beta handoff — October 29, 2026

## Evidence and acceptance

- Runtime source 75f3dfb is live on isolated Railway staging (deployment 35f9ebf7-06ea-48fc-aff9-4a4d9b202c2d). Its deployment marker matches; health returned 200 and signed-out renewal returned 401.
- At eba4663, TypeScript gates and all six Playwright jobs passed: desktop draft regression, full four-sport Zombie rehearsal, mobile, retention, referral and onboarding. Mobile: eight targeted Chrome/WebKit draft checks plus 136 broader mobile cases all passed without retries.
- The unit workflow found one missing C2C mock. The follow-up test-only correction passed all three original assertions locally; final-head hosted checks restart after publication. No application or failure-baseline change is included in that correction.
- This is browser emulation, not a physical iPhone acceptance result.
- The original four staging leagues remain setup/week zero/unstarted. Use separate QA rooms for start/pick/pause checks.
- Historical provider replay and the controlled eight-manager rehearsal do not establish a live-calendar beta result.

## Physical iPhone report still needed

Use the previously provided NFL, NBA, NHL and MLB QA draft links. Report model/iOS, cold and repeat load times, numeric stats, available ADP/order, missing photos, keyboard/search, queue reorder, portrait/landscape and safe-area clipping. Draft start/pick/pause/reopen is authorized only in those QA rooms.

## Live-calendar pilot

1. Agree on participating real managers and separate staging beta leagues; placeholder slots do not count as signed-up participants.
2. Choose an actual scoring period for each sport from the provider calendar. Finish drafts and legal lineups before its first lock.
3. Record provider observation dates and roster coverage before lock. NFL current market ADP is still an open source exception; do not substitute stale samples or label projections as ADP.
4. Let the normal scoring, finalization and Zombie settlement jobs run. Review missing-score blocks, winner/infection transitions, balances and transfers, serum/weapon/ambush deadlines, permanent Whisperer trade bans and once-only chat posts.
5. Check corrections and retry idempotency after the window. Record external prize status; this pilot does not transfer money.
6. For renewal acceptance, use a disposable completed-season fixture. Preview every manager's destination; check rules, empty rosters, unscheduled drafts and preserved old-season history before testing a next-season draft.

No physical-device result or live scoring window is marked accepted until its evidence is supplied.

## Current NFL ADP source decision

Rolling Insights' committed contract explicitly marks ADP unavailable; TheSportsDB covers metadata/media/schedules. Their existing keys do not close observed ADP coverage.

Fantasy Nerds' official NFL documentation lists standard, PPR, half-PPR and Superflex ADP and league sizes 8/10/12/14/16:
https://api.fantasynerds.com/docs/nfl

Its pricing page currently lists annual plans at $499 standard and $2,999 extended commercial, with eligibility conditions:
https://api.fantasynerds.com/getting-started/pricing

No subscription was purchased and no new endpoint was called. Before connecting: obtain licensed access or a current licensed export; confirm season, observation window/sample count, scoring and QB context, then capture the contract fixture and map canonical player IDs. Public documentation alone does not prove current in-season freshness. The existing /admin/adp-import workflow remains available for an eligible export.

Outstanding provider exceptions: 222 missing portrait URLs at the prior audit; NBA Jaden Akins lacks a verified fantasy-specific profile; undocumented NHL season goalie wins/shutouts remain omitted. Do not guess faces, positions or numeric statistics.

## October 29 renewal verification

Runtime source 75f3dfb adds the universe renewal preview and atomic next-season creation. The normal league-renew dialog directs Zombie leagues to their specialized controls.

An isolated Windows checkout and a fresh PostgreSQL 18 database bound to 127.0.0.1:55438 verified all four sports with two levels and 16 registered fixture managers per universe. Direct service checks covered real canonical league creation, next-season placements, empty unstarted drafts, old-roster/prize preservation, destination FAAB rollover, concurrent retries, a forced database failure on the final destination, and old/new season statistics/digest isolation. These are controlled fixtures, not a live-manager beta or signed-in device acceptance.

The focused local suites passed 56 tests in eight files, including the corrected C2C fixture. Windows cold imports required a 180-second CLI startup allowance; the committed CI timeout and assertions were unchanged. Hosted verification also passed the full four-sport three-level renewal rehearsal, including rollback, retries, preserved history and owner-only access. The isolated staging deployment is verified; final test-only-head checks remain separate evidence.

The owner chose to obtain additional NFL ADP provider access later. Do not purchase or activate a new subscription automatically.

## Read-only staging readiness snapshot

The original four leagues still have unstarted drafts and are at setup/week zero:

| Sport | Configured seats | Registered managers | Seats still to fill |
| --- | ---: | ---: | ---: |
| NFL | 8 | 1 | 7 |
| NBA | 8 | 1 | 7 |
| NHL | 12 | 1 | 11 |
| MLB | 8 | 1 | 7 |

Counts join roster ownership to actual AppUser records; placeholder team IDs do not qualify. No original league seats, settings, drafts or weeks were changed. All four current test leagues are standalone; the new linked-universe renewal does not yet provide their standalone renewal flow.

Follow-up regression: the C2C renewal fixture was missing the new non-Zombie lookup. Adding a null-returning ZombieLeague mock preserves all three original assertions; all three passed locally. This changes no deployed application code or failure baseline.

Recommended next coding: dedicated standalone Zombie renewal, then a commissioner readiness panel covering genuine managers, draft/lineup readiness and provider exceptions. Physical iPhone and live-calendar acceptance remain distinct owner/participant work.

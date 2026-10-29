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


## Standalone renewal and commissioner readiness follow-up

Commissioner → Zombie → General now contains Survival readiness and standalone season renewal. The dedicated Zombie commissioner page uses the same General panel. Linked universes retain their renewal and multi-league readiness in Universe controls.

Standalone renewal requires the native/Zombie season and draft to be complete, all required weekly settlements resolved, complete native standings and distinct registered managers. Preview and execution are owner-only; linked leagues must renew from their universe. An archived league row lock, content fingerprint, serializable retry and durable LEAGUE_SEASON_RENEWED receipt prevent partial/duplicate next seasons. It creates a separate league, copies approved rules, returns managers with fresh deterministic slots, applies the FAAB rule, and leaves old rosters/resources/roles/prizes in the old season. New drafts are unscheduled and unstarted; old Whisperers are not carried into a role.

Survival readiness is read-only. It counts distinct registered AppUser owners, reports draft progress, validates saved weekly/daily lineup slots with canonical rules, reports missing/flagged settlements and weekly posting approval, and measures the exact saved draft snapshot's numeric statistics, positions, portrait URLs and market ADP. Unknown or expired data is not treated as accepted. It does not fetch vendors, rebuild pools, spend AI credits, transfer money or certify a live beta.

Verification before publication: 30 focused tests passed in six files. Real disposable PostgreSQL checks passed standalone plus universe renewal for NFL, NBA, NHL and MLB, including forced rollback, concurrent retries, owner access, fresh draft/roster state, FAAB, archived history and latest-season readiness. Physical iPhone and live-calendar acceptance are still pending.

### Owner/device report template

- iPhone model and iOS version:
- Sport and QA league URL:
- Cold / repeat draft load seconds:
- Numeric stats and available ADP order:
- Search keyboard, filters, queue reorder:
- Portrait/landscape and safe-area clipping:
- Commissioner General: readiness cards fit, refresh works:
- Screenshot or observed issue:

Use only the separate QA rooms for start/pick/pause checks. Keep the original four drafts unstarted until real managers are ready.

### Recommended remaining work

1. Complete physical iPhone acceptance and a real-manager live scoring window when participants are ready.
2. Complete manual universe movement review/capacity-change workflows with preview and audit protections.
3. Resume current NFL ADP integration when the owner obtains licensed access; continue verified portrait/profile/stat exceptions without fabricating data.

Renewal UX reference reviewed: [Sleeper commissioner controls](https://support.sleeper.com/en/articles/3971182-what-can-a-commissioner-do). The new Zombie flow uses an explicit preview and a separate next-season league to preserve the completed season.


## Reviewed next-season universe capacity and placement

Commissioner Universe controls and the universe page now offer **Edit placements and capacity** after every source league finishes its season, draft and weekly settlements. The owner can add/remove next-season destination leagues, select an existing level and prior-league rule template, choose 8/10/12/14/16 seats, and assign every returning manager exactly once. No manager can be silently discarded. Level league limits and 24 destinations are enforced. Added seats remain open; drafts for expanded leagues require distinct registered managers in every seat before manual or scheduled starts.

A reason of 10-1,000 characters is required. Preview is read-only. Saving a review draft appends an owner audit record and creates no leagues; restore it after reopening. Every edit invalidates the approval and requires another preview. Creation binds the complete proposal, rules, membership, results and recorded movement to the preview hash. If recorded movement differs, explicit replacement consent is required; its full original allocation is retained with the actor, reason and new allocation in the audit trail. Completed leagues, rosters, resources and prizes remain archived. New destination rules, FAAB policies and draft settings come from the selected source template. This workflow changes next-season capacity, not current-season membership.

No schema migration, provider requests, external messages, money transfers or production changes are involved. Additional current NFL ADP access remains deferred by the owner. Physical iPhone acceptance and a real-manager scoring window remain open beta requirements. Engineering completion remains an estimate of about 96%; this is not a production release or live beta acceptance.

Implementation references: Sleeper [league resizing](https://support.sleeper.com/en/articles/4000484-how-to-decrease-league-size) and [nonplaying commissioners](https://support.sleeper.com/en/articles/3231520-can-i-commish-a-league-without-owning-a-team). AllFantasy explicitly reviews every returning manager before changing the next-season field and preserves the completed season.

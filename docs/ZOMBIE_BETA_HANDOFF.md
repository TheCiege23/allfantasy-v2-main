# Zombie beta handoff — October 29–30, 2026

## Current verification checkpoint

- Isolated Railway staging now serves renewal visual source `29c796f1f2f1c18e2887e7ecbeaee495eac6c386`, deployment `e9024206-0266-4201-9622-aed8ee56bb08`. SHA, database health, login/universe HTTP 200, signed-out renewal HTTP 401, linked CSS and shipped renewal copy all passed. Production is untouched.
- Actual shipped page assets passed Chromium and WebKit at 320, 390, 844 and 1440 pixel widths, with synthetic browser API responses, service workers disabled for fixture routing and all unhandled API writes blocked. Expansion preview/save/restore and invalidation after edits passed. These checks do not certify an authenticated owner session, a physical iPhone or a live scoring week.
- Read-only staging audit confirms the owner's saved review: two ten-seat destinations, 16 distinct returning managers, four open seats, zero unassigned managers, and no next-season creation. The original NFL/NBA/NHL/MLB drafts remain unstarted at week zero with one registered manager each.
- Draft PR integration incorporates main `1df9ffd836c99ea1f7344e29e91c2f88fa8b0c95`. Four draft conflicts preserve readable phone cards, sport-specific desktop stat tables, football-only bye labels, honest ADP null handling and the iOS visual viewport adjustment. Board/Half/Players and the board-size selector use one consistent state, including migration of saved preferences and recovery from a hidden board.
- A conflicting desktop rule was restricted to the Players preset. Actual merged-shell Chromium and WebKit checks measure player-list height increasing from 360 pixels in Half to 513 pixels in Players at 1440×900; phone portrait and landscape fit without document overflow. The harness uses synthetic player rows and does not certify provider-data completeness.
- Integrated focused verification: 206 tests passed in 13 files; the final board suite rerun passed 11 tests. Full-project TypeScript on published `e3c50595f` passed locally and in hosted CI (136 existing diagnostics against baseline 143, redraft zero). The integrated local compiler was stopped under severe shared-host memory pressure; its result is incomplete. Hosted CI must verify the newly published integration. Baselines and production guards are unchanged. DB-first, decision-engine and cron-budget guards also passed on the staged integrated tree.
- The e3c hosted browser workflow passed five other lanes and three Zombie scenarios. Its reviewed-capacity scenario exposed a synthetic fixture that skipped normal sport roster initialization. The fixture now uses the production `createDefaultLeagueRosterConfig` bootstrap, asserts source and renewed roster readiness and retains the exact expansion-seat start rejection. No production guard was bypassed or reordered. Local PostgreSQL four-sport proof passed: NFL consolidated 16 managers into one league; NBA/NHL retained 16 across two ten-seat leagues with four open seats; MLB distributed 16 across three eight-seat leagues with eight open seats. Source/renewed roster readiness, exact expansion-seat start rejection, archive/FAAB preservation, forced rollback and concurrent retry idempotency passed. This is direct-service fixture evidence, not a completed authenticated browser run.

Engineering estimate remains about 96%, separate from release acceptance. Next: verify the integrated candidate's hosted gates, review the live renewal visuals on the owner's iPhone, and prepare a real-manager scoring window once participants are ready. Current licensed NFL ADP access remains owner-deferred. Whisperers remain permanently forbidden from trading.

## Historical checkpoints

The following notes describe earlier candidates and audits. Use the current checkpoint above for live deployment and outstanding acceptance status.

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


## Completed-season iPhone renewal fixture — October 29

The isolated Railway staging database now contains **SYNTHETIC Renewal QA - NFL**, a two-level, two-league completed one-week fixture owned by the existing staging commissioner. It was built with canonical league creation on disposable localhost PostgreSQL, validated with the real editor and expansion preview, then inserted as one transaction through the staging Neon connection. No schema changes or existing-account updates were used.

- [Open the synthetic universe](https://zombie-web-staging.up.railway.app/zombie/universe/c5f33250-3aa8-42f9-8f93-243da15f63a7).
- Gamma source league: `1e71282a-e249-49ba-b16e-f976a50e76e9`; Alpha: `6bde01d8-951c-4c0f-b02a-5bc9649ffa74`.
- Sixteen distinct fixture managers, including the existing commissioner. Fifteen synthetic accounts have `.invalid` email addresses and no passwords. They are fixture identities, not recruited beta participants.
- Eight synthetic final matchups and two completed fixture-week records. The season, announcement and audit records explicitly label the data synthetic. No provider-scored week, real draft, buy-in, winning amount or payout is implied.
- Private league settings; no league listings or active invite records were copied. No next-season league has been created yet.
- Original NFL/NBA/NHL/MLB test leagues remain setup/week zero with unstarted drafts.

### Safari rehearsal

1. Sign in on the owner's iPhone and open the universe above. Select **Edit placements and capacity**.
2. Change both destination leagues from eight to ten seats, enter a reason, and preview. Expect 16 returning managers, 20 seats and four open seats.
3. Save the review, refresh and restore it. Search for a manager, move a manager between leagues and preview again. Edits must remove prior approval.
4. Check the keyboard, scrolling, destination selectors and buttons in portrait and landscape. Report iPhone/iOS version, load time and any clipped control or error.
5. Creation is optional and limited to this synthetic universe. Review every placement before creating 2027. Inspect the new separate leagues: open expansion seats, empty player rosters, unscheduled/unstarted drafts and preserved 2026 sources. Expansion drafts must remain blocked while seats are open.

Physical-device acceptance is pending the owner's report. Live-manager scoring acceptance remains pending real participants. Current NFL ADP provider access remains deferred.

### CI follow-up

The 8d789a5 rehearsal passed the native lifecycle and automatic/standalone renewal cases but exposed two remaining failures: an optional age-confirmation dialog covered renewal controls, and shared scoring loaded the campus module before checking whether the league was football C2C. The follow-up exercises the dialog's actual **Not now** action, waits for the editor response, and applies the existing pure C2C predicate before the lazy campus import. It retains the real authentication, approval, capacity and scoring assertions. Final hosted verification must be recorded separately; do not present a queued run or partial pass as a complete gate.

Local follow-up verification passed **79 tests in 12 files**, including the 53 Zombie renewal/access/approval cases and campus matchup/scoring regressions, on the integrated source with the format guard. The localhost browser re-run and new hosted verdict are tracked separately.


## Owner renewal report and visual polish — October 29

The owner reported that the requested synthetic iPhone Safari renewal workflow “seems to have worked,” while describing its visuals as very simple. This records reported success for the requested capacity expansion, preview, save and restore exercise. No iPhone model, iOS version, timing measurement or detailed orientation results were supplied; this does not certify every physical-device scenario, all four draft rooms or a real-manager scoring week.

The renewal panel and placement editor now use the existing Zombie emerald/cyan surfaces, tier badge tokens and icon language. The panel shows a Plan → Review → Create progression, a compact season transition, expandable archive/reset rules, destination occupancy bars, numeric manager/open-seat summaries, movement badges with text, readable manager rows and a distinct approval area. Destination tier colors retain the shared Gamma/Beta/Alpha definitions. Controls retain their existing names, 44px minimum targets, 16px inputs and visible focus rings. Grids stack on phones; long names wrap. Decorative icons and occupancy bars are hidden from screen readers because adjacent text supplies the values. Color is accompanied by text. Reduced-motion settings disable control transitions.

Shared presentation: `ZombieRenewalVisuals.tsx` exports `RenewalSummary` (manager/league/open-seat counts and optional unassigned count), `RenewalTierBadge` (existing level name), `RenewalCapacity` (assigned/seats, including an explicit over-capacity warning), and the shared control style. Counts use the current proposal or the server preview; no provider calls, new schema, invented data or role/trade changes are involved. The existing state/effect/request sections of both screens remain byte-equivalent to the preceding commit.

Verification on the polish candidate:

- 27 existing approval, commissioner-page, reviewed-proposal and API regression tests passed across four files.
- A local visual harness rendered the actual components with synthetic responses in Chromium and WebKit. At 320×740, 390×844, 844×390 and 1440×1000, no page-width overflow or non-checkbox input/button/select/textarea below 44px was found after viewport layout settled.
- The harness exercised two 8→10 seat changes, 16-manager/20-seat payload, hash-bound review save, restore, and removal of executable approval after another edit. No season creation or network database/provider action occurred in this harness. This is component/browser-engine evidence, separate from authenticated staging or physical-iPhone acceptance.
- Phone and desktop screenshots were visually inspected. Full hosted unit/browser CI and staging deployment status must be recorded separately.

Remaining acceptance: latest hosted CI, owner review of the polished staging screen, the remaining four-sport physical-device checks, and a real-manager live scoring window after recruitment. Current NFL ADP provider access remains deferred by the owner.

Typecheck follow-up: the initial full-project check reported 139 errors against a 143-error baseline, with three new nullable `useSearchParams` reads in the inherited `app/dev/league-mobile-preview/Preview.tsx`. The renewal screens had no diagnostics. The three reads now use optional access so the existing default preview remains available when parameters are absent. The baseline is unchanged; the follow-up full-project verdict is tracked separately.

The visual candidate `29c796f1f2f1c18e2887e7ecbeaee495eac6c386` is building in isolated Railway staging as deployment `e9024206-0266-4201-9622-aed8ee56bb08`. The reviewed environment patch changes only the pinned source SHA. No variables, schemas, schedules or production services were changed. This build does not include the subsequent preview-only null-guard cleanup; the Zombie renewal UI is identical between the two candidates.

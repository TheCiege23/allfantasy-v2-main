# G57 — NFL & NCAAF League Experience Visual Completion

## 1. Executive summary

G57 completed a source-level visual-system pass across the highest-traffic shared NFL/NCAAF redraft league surfaces. It did not change league authority, persistence, scoring, Trade OS, providers, authentication, production infrastructure, or production data.

The canonical league shell was already visually strong. The most important inconsistencies were inside its destinations: different loading/error/empty treatments, raw backend error leakage, an unreachable dedicated Players destination, duplicate waiver rendering, “Roster” versus “My Team” terminology, and NFL-only wording on the shared NCAAF home.

Implemented:

- One reusable league loading/empty/error/permission state component.
- Shared safe error and retry treatments for Matchups, Schedule, Standings, and Trades.
- No raw schedule, standings, matchup, trade-load, or trade-action backend messages shown in the changed paths.
- Dedicated Players navigation for NFL and NCAAF redraft using the existing canonical PlayersTab.
- Distinct My Team, Players, and Waivers labels without creating new pages.
- Removed the duplicate waiver-wire mount beneath PlayersTab; PlayersTab retains its existing embedded waiver/claim subtabs and the direct Waivers destination remains a shortcut to the same canonical waiver product.
- Explicit sport, season, and status identity in the shared league header.
- NCAAF-specific League Home identity and roster guidance.
- Optimized league avatar rendering through Next Image.
- Cleaner focus treatment and full-width action cards on League Home.
- Repaired two stale shell/navigation tests to match the current canonical client boundary and navigation truth.

Trusted browser control remains unavailable in this session, so no desktop or 390×844 runtime visual certification is claimed.

## 2. Complete surface inventory

| Surface | Canonical source | Scope | Visual/mobile finding |
| --- | --- | --- | --- |
| Dashboard league cards | `components/dashboard/FinalDashboardClient.tsx`, `ActiveLeaguesSection.tsx`, `DashboardSportGroups.tsx` | Shared | Established card system; not restyled in G57. |
| League shell/header/nav | `app/league/[leagueId]/LeagueShell.tsx` | Shared | Strong sticky shell; identity and mobile nav improved. |
| League Home | `NflRedraftLeagueHomeDashboard.tsx` | NFL/NCAAF redraft | Shared daily hub; NCAAF wording and focus treatment improved. |
| My Team/lineup | `TeamTab.tsx` and its roster components | Shared, sport-aware | Canonical and reachable; label unified to My Team. Runtime lineup editing remains uncertified. |
| Matchups | `MatchupTabContainer.tsx` | Shared | Live/final payload UI exists; loading/error/empty states unified. |
| Schedule | `CanonicalRedraftScheduleTab.tsx` → `ScheduleView.tsx` | NFL/NCAAF redraft | Canonical G46 surface; states unified, raw error removed. |
| Standings/playoffs | `RedraftStandingsPlayoffsView.tsx` → `StandingsView.tsx` | NFL/NCAAF redraft | Real season/bracket data; states unified, raw error removed. |
| Players | `app/league/[leagueId]/tabs/PlayersTab.tsx` | Shared | Now directly reachable in core redraft; contains search/filter/player market subtabs. |
| Free agents/waivers/claims | `PlayersTab.tsx` embedded `WaiverWirePage`; direct `SportAwareWaiverWire` tab | Shared | Same waiver product, two intentional entry points; duplicate simultaneous mount removed. |
| Trades | `TradesTab.tsx` + `ProposeTradeModal.tsx` | Shared | Native redraft builder/history/actions; safe retry/error copy added. |
| Draft setup/results | `DraftTab.tsx`, live draft room, post-draft views | Shared | G53/G56 territory; preserved. |
| League chat/activity | `LeftChatPanel`, League Chat tab/context surface | Shared | Canonical chat stays outside content obstruction on desktop; runtime mobile behavior unverified. |
| Members/invites | League settings/member panels and post-create guide | Shared | Canonical commissioner/member flows; no duplicate page created. |
| Commissioner workspace | `CommissionerOperationsWorkspace.tsx` | NFL/NCAAF core | Canonical G47 workspace; audited and preserved. |
| League settings | `LeagueSettingsModal`, `LeagueSettingsContentTab`, settings panels | Shared | Large canonical settings system; authorization/persistence unchanged. |
| Notifications | App shell/right control panel and existing notification services | Shared | No separate duplicate league notification page identified. |
| Player detail | Shared player click/detail routes and drawers | Shared | Existing normalized imagery/data path; no provider image dependency added. |
| Permission/not-found | League page/server boundary plus commissioner-only cases | Shared | Server gates remain authoritative; shared permission visual is now available for future adoption. |

## 3. Canonical versus duplicate surfaces

- `LeagueShell` is the canonical league journey router. No new league page was created.
- `CanonicalRedraftScheduleTab` remains the only core schedule destination; G57 wrapped its states rather than creating another schedule.
- `RedraftStandingsPlayoffsView` remains the core standings/playoff destination.
- `PlayersTab` already includes Available Players, Waivers, Free Agents, and My Claims. G57 removed the extra `SportAwareWaiverWire` rendered below it.
- The direct Waivers tab remains a purposeful shortcut to the canonical sport-aware waiver product, not a separate implementation.
- `components/app/tabs/*`, `components/league/*`, specialty home pages, and legacy sport tabs remain reusable or legacy alternatives for other product modes; they were not forced into football redraft.
- LeagueShell’s direct client wrapper is canonical. The old test expecting an additional `dynamic(..., ssr:false)` layer was stale and was corrected.

## 4. Shared league-shell findings

Strengths already present:

- Sticky identity/header and horizontally scrollable tab rail.
- Sport-aware league logo fallback.
- Commissioner badge and permission-aware Commissioner tab.
- League-specific settings/member menu.
- Desktop chat and control rails with mobile access.
- Active tab state, safe-area bottom padding, 44-pixel mobile tab targets, roster issue badges, and deep-link synchronization.

G57 improvements:

- Added explicit NFL/NCAAF sport badge.
- Added season and customer-safe league-status badges.
- NCAAF uses amber identity treatment while remaining within the same AllFantasy shell.
- Renamed core Roster navigation to My Team.
- Added canonical Players destination.
- Applied scrollbar suppression to the actual scrolling tab rail.
- Replaced raw `<img>` league avatar with Next Image using explicit dimensions and safe unoptimized handling for user-controlled URLs.

Platform-admin controls were not added. Commissioner actions remain permission-gated.

## 5. League Home findings

The canonical home already provides pre-draft/in-season variants, commissioner/member quick actions, member readiness, rules, chat, Manager/League Intelligence, communications, and real league/week context.

G57:

- Displays “NCAAF Redraft League Home” for college leagues.
- Removes NFL bye-week assumptions from the NCAAF roster tile.
- Replaces the branded helper tile with customer-safe “Ask League Coach” and “Decision support” copy.
- Makes actionable cards full-width and keyboard-focus visible.

It remains a focused hub rather than duplicating Commissioner Operations.

## 6. My Team and lineup findings

- Canonical `TeamTab` is shared and sport-aware.
- My Team naming now matches the customer journey.
- Existing player, roster, IDP, specialty, lock, and settings entry paths were preserved.
- No success state was changed and no optimistic persistence was introduced.
- Physical lineup save, lock, drag/move, IR, and mobile keyboard behavior remain authenticated-runtime gates.

## 7. Matchup and schedule findings

Matchups already support team headers, starters, score/projection payloads, week selection, freshness age, refresh, insights, and start/sit entry.

G57 unified:

- Loading: stage-specific and screen-reader announced.
- Error: actionable retry, no raw server response, explicit “lineup was not changed.”
- Empty lineup: explains how player contributions appear.

Schedule remains the G46 canonical view. Its pre-season, loading, and failure states now use the same state system. Regular/playoff/bye/future/winner details remain owned by ScheduleView.

## 8. Standings findings

- Real redraft season and standings APIs remain authoritative.
- Existing StandingsView owns records, points, ranks, and playoff controls.
- Loading explains that completed results drive calculations.
- Pre-draft state explains when records/bracket appear.
- Failure no longer exposes raw technical messages and provides retry.

Current-user highlighting, tiebreaker explanations, and full mobile table/card certification remain follow-up design-review items.

## 9. Players and waiver findings

- Players is now directly reachable for both NFL and NCAAF core redraft.
- Existing PlayersTab provides search, position/team filters, watchlist, rookies, projections, normalized imagery, NCAAF beta/pending truth, Available/Waivers/Free Agents/My Claims subtabs, and embedded waiver UI.
- The duplicate second waiver wire below PlayersTab was removed.
- Direct Waivers remains a useful shortcut and uses `SportAwareWaiverWire`.
- No player data, projection, image, injury, or stat was fabricated.
- Existing NCAAF unavailable/pending state remains honest.

## 10. Trade findings

- Existing native trade builder, incoming/outgoing/history state, trade block, accept/reject/cancel, and commissioner approve/veto paths were preserved.
- Trade list failure now uses the shared state with retry.
- Trade actions no longer pass raw server errors directly to customers.
- Failed action copy explicitly says nothing changed.
- No fairness certainty, provider mechanics, model output, or Trade OS reversal claim was added.

## 11. Commissioner workspace findings

The G47 workspace remains canonical and organizes operations, settings, transactions, draft, members, and communication with permission-aware states. G57 did not duplicate or broadly restyle it. It inherits the improved shell identity/navigation. Authenticated destructive-action review and mobile design review remain required.

## 12. Settings findings

The canonical settings modal/tab already groups general, scoring, roster, draft, waiver, trade, playoff, specialty, notification, and commissioner panels. G57 preserved authorization and persistence. A broad settings rewrite was intentionally avoided. Remaining review: irrelevant setting visibility by sport/type, frozen-save messaging, and 390×844 form/dialog behavior.

## 13. Chat findings

- Existing desktop left panel and mobile chat entry remain canonical.
- League Chat tab explains context without duplicating the backend.
- Draft/league contexts, user/system events, announcements, reactions/polls/media paths remain existing infrastructure.
- No DM or new chat infrastructure was added.
- Mobile keyboard positioning, focus trapping, message ordering, and notification behavior remain runtime certification items.

## 14. NFL/NCAAF parity findings

Verified source parity:

- Core redraft gate supports both NFL and NCAAF.
- Same Home, My Team, Matchups, Schedule, Players, Waivers, Trades, Standings, Chat, Commissioner navigation.
- Sport badge distinguishes NCAAF without creating a different product.
- NCAAF Home removes bye-week-specific guidance.
- PlayersTab uses shared football positions and explicit NCAAF pending/beta truth.
- Schedule language is sport-neutral.

Remaining NFL-first areas:

- Component/file naming still says “NflRedraft” despite shared runtime behavior.
- Live NCAAF logos, projections, stats, injuries, schedules, and player completeness are provider-certification gates.
- Some generic player table column language remains football-stat oriented and needs visual review with real NCAAF data.

## 15. Mobile findings

Source-level improvements:

- 44-pixel league nav targets.
- Safe-area bottom padding.
- Snap scrolling with hidden scrollbar on the actual rail.
- State cards wrap and remain within a bounded width.
- Retry buttons meet 44-pixel minimum height.
- Header badges wrap rather than forcing page overflow.

390×844 runtime visual certification is blocked because trusted browser control is unavailable. No screenshots or mobile-pass claim were fabricated.

## 16. Accessibility findings

- Shared loading/empty states use status semantics.
- Error/permission states use alert semantics.
- Loading exposes `aria-busy` and polite announcements.
- Retry controls have visible focus treatment and explicit labels.
- League home action cards have keyboard focus rings.
- Existing nav keeps tablist/tab/aria-selected semantics.
- League images have fixed dimensions to reduce layout shift.

Remaining: full heading hierarchy, modal/drawer focus traps, screen-reader table traversal, and color-contrast verification in a real browser.

## 17. Performance findings

- Replaced the shell avatar’s raw image with sized Next Image, reducing layout shift while preserving arbitrary user image compatibility through `unoptimized`.
- Removed simultaneous duplicate waiver-wire rendering from Players.
- Corrected matchup refresh effect dependencies to use the authoritative payload object.
- Removed unnecessary shell memo dependencies and repaired missing effect dependencies found by targeted lint.
- No new requests or blocking secondary panels were introduced.

## 18. Design-system improvements

`LeagueSurfaceState` establishes one reusable language for:

- loading,
- empty,
- error,
- permission,
- compact/full layouts,
- optional retry,
- safe customer explanation,
- accessible status/alert semantics.

It uses the existing AllFantasy dark/cyan/amber/rose palette, spacing, rounded cards, and focus treatment.

## 19. Changes implemented

1. Added shared LeagueSurfaceState.
2. Applied it to Matchups, Schedule, Standings, and Trades.
3. Removed raw error rendering from changed customer paths.
4. Added Players to core NFL/NCAAF navigation.
5. Unified Roster label as My Team.
6. Removed duplicate waiver-wire mount from Players destination.
7. Added sport/season/status shell identity.
8. Added NCAAF-specific Home label and roster copy.
9. Improved Home card focus/width behavior.
10. Optimized league avatar layout.
11. Fixed memo/effect dependency warnings in touched paths.
12. Added G57 regression coverage and updated two stale shell contracts.

## 20. Files modified

- `components/league/LeagueSurfaceState.tsx`
- `components/league-home/NflRedraftLeagueHomeDashboard.tsx`
- `components/matchup-center/MatchupTabContainer.tsx`
- `app/league/[leagueId]/LeagueTabs.tsx`
- `app/league/[leagueId]/LeagueShell.tsx`
- `app/league/[leagueId]/tabs/TradesTab.tsx`
- `app/league/[leagueId]/tabs/redraft/CanonicalRedraftScheduleTab.tsx`
- `app/league/[leagueId]/tabs/redraft/RedraftStandingsPlayoffsView.tsx`
- `__tests__/redraft/g57-league-visual-system.test.ts`
- `__tests__/nfl-redraft-core-tab-bar.test.ts`
- `__tests__/league-shell-waivers-layout.test.tsx`
- `docs/redraft/G57_NFL_NCAAF_LEAGUE_EXPERIENCE_VISUAL_COMPLETION.md`

The worktree was heavily modified before G57. Unrelated changes were preserved.

## 21. Test and validation results

All Vitest commands used `--pool=threads --maxWorkers=1`.

- Shell/navigation/home/schedule/G57 group: **5 files, 49 tests passed**.
- Standings/trades/commissioner/matchup group: **5 files, 34 tests passed**.
- Chat/settings/NFL-NCAAF route and sport-adapter parity: **4 files, 11 tests passed**.
- Final changed G57/core/shell rerun: **3 files, 33 tests passed** (overlaps the first group and is not double-counted).

Distinct validated total: **14 files, 94 tests passed, 0 failures, 0 skips, 0 retries, 0 timeouts** in the final validated groups.

An earlier six-file run reported 49 passing tests and two shell-test failures: one expected navigation contract change and one stale dynamic-wrapper assertion. Both were corrected and the affected suite passed on rerun. These were failures, not counted as passes until rerun.

Static validation:

- Targeted ESLint: **PASS**, 0 errors, 0 warnings.
- `git diff --check`: **PASS**; line-ending notices only.
- Targeted TypeScript: no G57 file errors. The dependency graph remains blocked by nine baseline issues:
  - Session `user.id` typing in three IDP files, ProposeTradeModal, and CommissionerLeagueDeletePanel.
  - `lib/auth.ts` session fields `username`, `id`, and `spotifyAccount`.
  - Missing declarations for `web-push`.
- Browser/mobile validation: **BLOCKED**; no trusted browser connection.

## 22. Remaining visual work

- Authenticated 390×844 and desktop review of all canonical tabs.
- My Team save/lock/error/IR visual confirmation.
- Standings current-team highlight and tiebreaker explanation review.
- Real NCAAF player table/card review with school logos and actual availability states.
- Waiver claim amount/drop/conflict flows with real data.
- Trade detail deadlines, expiration, roster consequences, and commissioner audit display with real offers.
- Commissioner destructive-action design review.
- Settings frozen/save states and specialty visibility review.
- Chat keyboard, safe-area, composer, mention/system-event, and error-state review.
- Shared state adoption by remaining lower-traffic legacy/specialty surfaces.

## 23. Runtime certification still required

- G48 authenticated create/import/full-season validation.
- G53B authenticated multiplayer draft certification.
- G52 live-provider freshness/caching/fallback certification.
- Authenticated lineup, waiver, trade, chat, commissioner, settings, and persistence workflows.
- Real database and real development data evidence.

## 24. Updated readiness assessment

Visual source quality improved, but published readiness does not change without runtime evidence:

- NFL Redraft: **95%**
- NCAAF Redraft: **80%**
- August 10 Controlled Beta: **70%**

## 25. Recommended next phase

The next phase should be authenticated create/import certification when a trusted browser is available. That validates the entry journey and establishes the authenticated evidence base needed before the final invited-MVP launch review. If multiple authenticated users become available first, G53B multiplayer draft certification is the next best evidence-producing phase.

```text
G57 LEAGUE EXPERIENCE VISUAL COMPLETION: PARTIAL
SHARED LEAGUE SHELL UNIFIED: YES
LEAGUE HOME POLISHED: YES
MY TEAM AND LINEUP POLISHED: PARTIAL
MATCHUPS AND SCHEDULE POLISHED: YES
STANDINGS POLISHED: PARTIAL
PLAYERS AND WAIVERS POLISHED: PARTIAL
TRADES POLISHED: YES
COMMISSIONER WORKSPACE POLISHED: PARTIAL
SETTINGS POLISHED: PARTIAL
CHAT POLISHED: PARTIAL
NCAAF VISUAL PARITY IMPROVED: YES
MOBILE SOURCE RESPONSIVENESS IMPROVED: YES
MOBILE RUNTIME VISUALLY CERTIFIED: BLOCKED
ACCESSIBILITY IMPROVED: YES
READY FOR CUSTOMER DESIGN REVIEW: YES
READY FOR INVITED MVP: NO
```

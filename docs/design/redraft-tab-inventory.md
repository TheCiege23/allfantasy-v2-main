# Redraft tab inventory — for the per-tab restyle phases

Every screen a native redraft league member can open, the files that draw it, and which files are
**shared** — so later agents can be batched without two of them editing the same file. Measured on
`origin/main` at `41263b4e98` (2026-10-31) by reading `LeagueShell.tsx`'s render switch,
`buildNativeLeagueNavigation`, `AfCoreShell`'s nav and each screen's CSS imports (two levels deep).
Re-check before building: these files move daily.

🛑 **THERE ARE TWO SURFACES, AND ONLY ONE CARRIES THE REDRAFT IDENTITY TODAY.**

| surface | route | chrome | identity? |
|---|---|---|---|
| **A. League workspace** | `/league/[id]?view=<tab>` | `NativeLeagueWorkspace` (left rail, `.nl-sidebar`, `.nl-bottom-nav`) | ✅ `data-format=redraft` + `data-sport` |
| **B. /core shell** | `/core/<screen>?league=<id>` | `AfCoreShell` (the light af-core sidebar) | ✅ since CORE-1 — same two attributes on `.af-core.af-shell` (`lib/core-app/coreShellRedraftIdentity.ts`) |

The sidebar the owner screenshots — *Home, Brackets, My team, Defense Hub, Matchup, War Room, Waivers,
Trades, Player Finder, Draft HQ, Your week, Live scores, Standings, Season Outlook* — is **surface B**
(`AfCoreShell`, labels from `lib/core-app/navLabels.ts`). *Commissioner, Settings (modal + tab) and League
chat* exist on both. A restyle phase must say which surface it targets; carrying the tokens to B means
stamping the same two attributes on `AfCoreShell`'s root for a redraft `selectedLeague` (a shared file,
~3,000 lines, every league type) — a foundation decision, not a tab task.

## A. `/league/[id]` — the native workspace

Tab ids are what `LeagueShell` builds for a native redraft league; the sidebar groups them via
`lib/league/nativeLeagueNavigation.ts`. Football (NFL, NCAAF) takes the `nflRedraftCore` tab list;
NBA / NHL / MLB / NCAAB / Soccer take `getLeagueTabsForViewer(sport)` (`app/league/[leagueId]/LeagueTabs.tsx`)
— so the same nav label can open a different component by sport (noted per row).

| nav label (group) | view id | top component | CSS | sport differences |
|---|---|---|---|---|
| League home (This league; phone "League") | `native_home` | `components/league/native/NativeLeagueHome.tsx` (+ `LeagueYourWeekStrip.tsx`) | `native-league.css` (`.nl-home`, `.nl-card`, `.nl-yourweek*`), `league/commissioner-setup-checklist.css` | none in the shell |
| Home (More tools, football only) | `home` | `components/league-home/NflRedraftLeagueHomeDashboard.tsx` | `league/league-overview.css` | NFL/NCAAF only |
| My team (phone "Team") | `roster` / `team` / `squad` | `components/league/native/screens/NativeLineupScreen.tsx` | `native/screens/native-screens.css` | weekly (NFL/NCAAF) vs daily lineups (NBA/NHL/MLB/NCAAB); Soccer's id is `squad` |
| Matchup (phone "Matchup") | `matchups` / `matchup` | `.../screens/NativeMatchupScreen.tsx` | `native-screens.css` | Soccer has `fixtures` instead (`FixturesTab`, Tailwind) |
| Players & waivers (phone "Players") | `waivers` | `.../screens/NativeWaiversScreen.tsx` | `native-screens.css` | — |
| Players (More tools) | `players` | `app/league/[leagueId]/tabs/PlayersTab.tsx` | `league/league-transactions.css` | — |
| Trades | `trades` | `.../screens/NativeTradesScreen.tsx` | `native-screens.css`, `league/league-transactions.css` | Soccer also has `transfers` (`TransfersTab`, Tailwind) |
| Draft HQ (phone "Draft" pre-season) | `draft` | `app/league/[leagueId]/tabs/DraftTab.tsx`; pre-draft: `renderPredraftDraftSetup` in `LeagueShell.tsx` (Tailwind) | `league/league-overview.css` | — |
| Standings & playoffs | `standings` | `.../screens/NativeStandingsScreen.tsx` | `native-screens.css` | Soccer `table` (`TableTab`, Tailwind) |
| League chat (phone "Chat") | `league_chat` | `components/chat/LeagueChatSurface.tsx` | `chat/league-chat-channels.css`, **`core-app/af-comms.css`** | — |
| Commissioner (commissioner only → Settings page) | `settings` | `app/league/[leagueId]/tabs/LeagueSettingsTab.tsx` | `core-app/af-invite.css` | — |
| Commissioner (More tools) | `commissioner` | `components/league-home/CommissionerOperationsWorkspace.tsx` | **`decide/broadcast-deck.css`**, `league/league-admin.css` | — |
| League settings button / modal | (modal) | `app/league/[leagueId]/components/LeagueSettingsModal.tsx` | `league/league-workspace.css`, `league/league-admin.css` and others it embeds | — |
| War Room (This week) | `war_room` | `app/league/[leagueId]/tabs/WarRoomTab.tsx` | none (Tailwind) | label is "AF Legacy" in the non-football tab list |
| Live scores (This week) | `scores` | `app/league/[leagueId]/tabs/ScoresTab.tsx` | none (Tailwind) | only in the non-football list |
| Decision OS (This week) | `decide` | `components/decide/DecideHome.tsx` | **`decide/broadcast-deck.css`** | — |
| Chimmy Coaching (More tools) | `ai_coaching` | `app/league/[leagueId]/tabs/AICoachingTab.tsx` | none (Tailwind) | "Manager Intelligence" in the non-football list |
| Live Intel (More tools) | `draft_intel` | `components/decide/DraftIntelHome.tsx` | **`decide/broadcast-deck.css`** | — |
| Legacy (More tools) | `legacy` | `components/decide/LegacyHome.tsx` | **`decide/broadcast-deck.css`** | — |
| Schedule (More tools) | `schedule` | `app/league/[leagueId]/tabs/redraft/CanonicalRedraftScheduleTab.tsx` (football) / `tabs/ScheduleTab.tsx` | none (Tailwind) | — |
| Your career / Rankings (Your record) | links | `/core/career`, `/core/rankings` — surface B | — | — |
| Defense Hub | `defense_hub` | `app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx` | `core-app/af-core.css` | **IDP leagues only — and IDP is excluded from the redraft identity** (see redraft-identity.md) |

Workspace chrome (header, season track, sidebar, phone bars, switcher): `NativeLeagueWorkspace.tsx`,
`RedraftSeasonTrack.tsx`, `native-league.css`, `redraft-identity.css` — **owned by the foundation**.

## B. `/core` — the AfCoreShell screens (owner's sidebar)

Router: `app/core/(shell)/[[...screen]]/page.tsx`; screens lazy-load from
`components/core-app/screens/LazyScreens.tsx`. Chrome: `AfCoreShell.tsx` + `af-core-shell.css`,
`af-core.css`, `af-comms.css`, `af-connected-navigation.css` and others.

| nav label | route | top component | CSS |
|---|---|---|---|
| Home (league overview) | `/core?league=` | `screens/LeagueHome.tsx` — ⚠ **imported leagues only**: for a native league the page redirects to `/league/[id]` before any home read (`leagueEntryHref`, "Canonical entry for AF-hosted leagues", #2892), so a native redraft league's /core "Home" IS surface A's League home | `af-league-home.css`, `charts/workbook-chart.css` |
| Brackets | `/brackets` (not league-scoped) | `screens/BracketChallenge.tsx` | `af-bracket.css` |
| My team | `/core/my-team` | `screens/MyTeam.tsx` | `af-my-team.css`, `af-team-workspace.css`, `highlights/recent-clips.css`, **`af-player-card.css`** |
| Defense Hub | `/core/defense-hub` | `DefenseHubClient.tsx` | `af-core.css` (IDP only) |
| Matchup | `/core/matchup` | `screens/Matchup.tsx` | `af-matchup.css`, `af-matchup-pulse.css`, **`af-player-card.css`** |
| War Room | `/core/war-room` | `screens/ConnectedFranchiseWarRoom.tsx` | `af-connected-war-room.css` |
| Waivers | `/core/waivers` | `screens/Waivers.tsx` | `af-waivers.css`, **`af-core-lock.css`**, **`af-player-card.css`**, **`decide/broadcast-deck.css`** |
| Trades | `/core/trades` | `screens/Trades.tsx` | `af-trades.css`, **`af-player-card.css`** |
| Player Finder | `/core/players` | `screens/PlayerFinder.tsx` | `af-player-finder.css`, `af-refresh-lineups.css`, **`af-core-lock.css`** |
| Draft HQ | `/core/draft-hq` | `screens/DraftHq.tsx` | `af-draft-hq.css`, `af-draft-analysis.css`, `af-draft-preparation.css`, **`af-core-lock.css`** |
| Your week | `/core/week` | `screens/YourWeekLeague.tsx` | `af-week-league.css`, `af-week-lineup.css` |
| Live scores | `/core/live` | `screens/LiveScores.tsx` | `af-live.css`, **`af-player-card.css`** |
| Standings | `/core/standings` | `screens/Standings.tsx` | **`af-standings.css`**, **`af-outlook.css`**, `af-season-outlook.css`, `sports-os/af-freshness.css` |
| Season Outlook | `/core/season-outlook` | `screens/SeasonOutlookLeague.tsx` | `af-season-outlook-league.css`, **`af-standings.css`**, **`af-outlook.css`**, `sports-os/af-freshness.css` |
| Commissioner | `/core/commissioner` | `screens/CommissionerHub.tsx` | `af-commish-hub.css`, `af-commish-waivers.css`, `af-format-hubs.css`, `commissioner-weekly-plan.css`, **`af-standings.css`**, **`af-core-lock.css`** |
| Settings | `/settings` (account, not league) | — | — |

Sport differences on B are inside the screens (daily vs weekly lineup in `MyTeam`/`YourWeekLeague`,
sport-specific stat columns); none of them branch the CSS file set.

## Shared files — nobody restyles these inside a tab batch

| file | shared by |
|---|---|
| `core-app/af-core.css` | everything (palette) — foundation only |
| `league/native/native-league.css` | workspace chrome **and** League home — foundation owns the chrome rules; the home batch owns `.nl-home*`/`.nl-card*`/`.nl-yourweek*` and must not touch the rest |
| `league/native/screens/native-screens.css` | My team, Matchup, Waivers, Trades, Standings (A) |
| `league/league-transactions.css` | Trades (A), Players (A), settings modal |
| `league/league-overview.css` | Draft HQ (A), Home (football), settings modal |
| `decide/broadcast-deck.css` | Decision OS, Live Intel, Legacy, Commissioner ops (A) **and** `/core` Waivers (B) |
| `core-app/af-comms.css` | League chat (A) **and** the AfCoreShell chrome (B) |
| `core-app/af-player-card.css` | My team, Matchup, Waivers, Trades, Live scores (B) |
| `core-app/af-core-lock.css` | Waivers, Player Finder, Draft HQ, Commissioner (B) |
| `core-app/af-standings.css`, `af-outlook.css` | Standings, Season Outlook, Commissioner (B) |

## Proposed batches (non-overlapping file sets)

Surface A (identity is live — start here):

| batch | screens | owns |
|---|---|---|
| **A1 Home** | League home, football Home, Draft HQ | `NativeLeagueHome.tsx`, `LeagueYourWeekStrip.tsx`, `NflRedraftLeagueHomeDashboard.tsx`, `DraftTab.tsx`, `league-overview.css`, `commissioner-setup-checklist.css`, the `.nl-home*`/`.nl-card*`/`.nl-yourweek*` rules of `native-league.css` |
| **A2 Native screens** | My team, Matchup, Waivers, Trades, Standings, Players | `screens/Native*Screen.tsx`, `NativeScreenParts.tsx`, `native-screens.css`, `PlayersTab.tsx`, `league-transactions.css` — one agent, or split `native-screens.css` per screen as its first commit |
| **A3 Broadcast deck** | Decision OS, Live Intel, Legacy, Commissioner ops | `components/decide/*`, `CommissionerOperationsWorkspace.tsx`, `broadcast-deck.css`, `league-admin.css` — **coordinate with B5**, which shares `broadcast-deck.css` |
| **A4 Chat** | League chat | `LeagueChatSurface.tsx`, `league-chat-channels.css` — **not** `af-comms.css` (shell-shared) |
| **A5 Settings** | Settings tab + League settings modal | `LeagueSettingsTab.tsx`, `LeagueSettingsModal.tsx`, `af-invite.css`, `league-workspace.css` — modal touches `league-admin.css` (A3): sequence after A3 |
| **A6 Tailwind tabs** | War Room, Live scores, Chimmy Coaching, Schedule | the four TSX files only (no stylesheet) — move their colours onto `--rd-*` tokens |

Surface B (needs the AfCoreShell decision first):

| batch | screens | owns |
|---|---|---|
| **B1** | Home | `LeagueHome.tsx`, `af-league-home.css` — ⚠ unreachable for native redraft today (the /core home redirects native leagues to `/league/[id]`; see the row above). Either lift that redirect for native redraft (a navigation decision) or fold B1 into **A1** |
| **B2** | My team + Your week | `MyTeam.tsx`, `YourWeekLeague.tsx`, `af-my-team.css`, `af-team-workspace.css`, `af-week-*.css` |
| **B3** | Matchup + Live scores | `Matchup.tsx`, `LiveScores.tsx`, `af-matchup*.css`, `af-live.css` |
| **B4** | Trades + War Room | `Trades.tsx`, `ConnectedFranchiseWarRoom.tsx`, `af-trades.css`, `af-connected-war-room.css` |
| **B5** | Waivers + Player Finder + Draft HQ | `Waivers.tsx`, `PlayerFinder.tsx`, `DraftHq.tsx`, `af-waivers.css`, `af-player-finder.css`, `af-draft-*.css` |
| **B6** | Standings + Season Outlook + Commissioner | `Standings.tsx`, `SeasonOutlookLeague.tsx`, `CommissionerHub.tsx`, `af-standings.css`, `af-outlook.css`, `af-season-outlook*.css`, `af-commish-*.css` |
| **B0 (shared, last)** | player cards, locks | `af-player-card.css`, `af-core-lock.css` — one agent after B2–B5, since four batches render them |

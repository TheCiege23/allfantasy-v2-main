# Source-platform deep links for imported leagues

AllFantasy is **read-only** for imported leagues: it analyzes, flags what needs attention, and recommends
an action — but the user completes that action on the **original platform** (Sleeper / ESPN / Yahoo / …).
This feature takes the user to the closest **reliable** location on that platform.

> "AllFantasy analyzes and recommends. Changes to imported leagues are completed on the original platform."
> (`lib/league-links/readOnlyNote.ts` — use once per surface, not on every card.)

## Centralized resolver — `lib/league-links/sourceLinkResolver.ts`

One `resolveSourceLink(ctx)` — **pure + server-safe, never calls a provider API** (safe on the render
path). Consumers pass canonical context (`platform`, `sourceLeagueId` = `League.platformLeagueId`,
`leagueName`, optional `action`/`season`); they must **not** build provider URLs themselves.

Returns `{ href, destinationType, provider, providerLabel, label, isFallback, opensExternally } | null`
(null for native/unknown leagues → render no button).

### URL priority (never invents a route)
1. A previously-**stored** provider url — used **only** if it passes the provider allowlist.
2. A **verified** direct league page (launch providers only).
3. The approved platform **homepage** (`isFallback: true`).

If a league id is missing/blank, or the provider has no verified league format, it falls back to the
homepage. Uncertain sub-routes (per-action / roster / matchup pages) are **not** invented — the league
page is the destination and the *label* stays action-aware.

### Supported destinations by platform

| Platform | Direct league link (verified) | Fallback |
|---|---|---|
| **Sleeper** | `https://sleeper.com/leagues/{leagueId}/league` | `https://sleeper.com` |
| **ESPN** | `https://fantasy.espn.com/football/league?leagueId={leagueId}[&seasonId={year}]` | `https://fantasy.espn.com/football/` |
| **Yahoo** | `https://football.fantasysports.yahoo.com/f1/{leagueId}` (`f1` = NFL) | `https://football.fantasysports.yahoo.com` |
| **MyFantasyLeague** | — (needs per-league server subdomain + year) | `https://www.myfantasyleague.com` |
| **Fantrax** | — (opaque league slugs) | `https://www.fantrax.com` |
| **Fleaflicker** | — (import not enabled) | `https://www.fleaflicker.com` |

Launch-ready direct linking: **Sleeper, ESPN, Yahoo**. MFL / Fantrax / Fleaflicker resolve to a safe
homepage (architecture supports adding their league formats later without touching consumers).

### Action-aware labels
`Fix Lineup in {league}` · `Review Trade in {league}` · `Manage Waivers in {league}` ·
`View Matchup in {league}` · `Open {league} in {provider}`. Homepage fallback → `Go to {provider}`.

## Security controls (`isSafeProviderUrl`)
Every returned href passes a single gate: **HTTPS required**; hostname must **exactly** match a
per-provider allowlist (rejects subdomain look-alikes like `sleeper.com.evil.com` and open-redirects);
`javascript:` / `data:` / `file:` and any non-https scheme rejected; embedded credentials rejected;
malformed urls rejected. Constructed urls `encodeURIComponent` the league id (no path/host injection).
Stored/legacy urls are validated before display. The UI opens links with
`target="_blank"` + `rel="noopener noreferrer"` (and `window.open(…, 'noopener,noreferrer')`).
No provider credentials, tokens, or raw payloads are ever exposed.

## Reusable component — `components/league-links/SourceActionLink.tsx`
Resolves via `resolveSourceLink` and renders a hardened new-tab anchor (or nothing for native leagues).
`ReadOnlyLeagueNote` renders the canonical read-only disclosure. Consumers never build URLs or anchors.

For surfaces that carry only the internal `League.id` (not the source id), use the server helper
`lib/league-links/resolveSourceLinkForLeague.ts` — a **DB-only** lookup (no provider fetch) that maps
`League.id → { platform, platformLeagueId, name, season } → resolveSourceLink`. Batch variant included.

## Schema
**No schema change.** The canonical fields (`platform`, `platformLeagueId`, `name`, `season`) already
exist on `League` and are already surfaced by `/api/league/list`
(`lib/dashboard/get-dashboard-league-list.ts`).

## Surfaces wired in this PR
- **Settings → League Imports** (`app/settings/components/sections/ImportedLeaguesPanel.tsx`) — a source
  link per imported row.
- **Imported-league page header** (`app/league/[leagueId]/LeagueShell.tsx`) — a header chip; also covers
  the dashboard's embedded league hub (`SelectedLeagueHomePanel` iframes `/league/[id]`). The Leave-league
  modal's ad-hoc Sleeper link was consolidated onto the resolver (removed a `platform === 'sleeper'`
  hardcode + hand-built URL).
- **Trade recommendations** (`components/TradeFinderClient.tsx`) — replaced the ad-hoc
  `https://sleeper.app/leagues/{id}/trade` `window.open` (wrong host: `sleeper.app` is the API) with the
  allowlisted resolver (`action:'trade'`, all providers, safe new-tab open).

## Decision OS action loop (`RecommendationTimeline`)
> **Live-path note (2026-07-28):** `RecommendationTimeline` is rendered only by `DashboardOverview` →
> `DashboardShell`, which the production `/dashboard` **no longer renders** (it was replaced by
> `NocturneDashboard` at the Nocturne cut-over). So this specific card is currently **not on the live
> path** — but the route enrichment it introduced (`enrichLineupActionsWithLinks` on
> `body.lineup.actions`) **is** live: the live "Top outstanding issues" alert list (below) consumes it.

The Decision OS card feed (`app/dashboard/components/warroom/RecommendationTimeline.tsx`, fed by
`GET /api/dashboard/today-actions` → `runTodayActions` → `computeLineupActionsForUser`) renders, per
actionable imported card: an **internal** AllFantasy analysis action, a **secure external** source-platform
action, freshness, and (once per card) the read-only disclosure. The external link is resolved
**server-side in the route** from the canonical `League` row via `enrichLineupActionsWithLinks`
(`lib/league-links/enrichDecisionOsActions.ts`) — never from a URL carried by the item, a cached payload,
or the client (items hold no navigation URL). DB-first: no provider fetch on the response path.

Signal → action (chosen from the normalized `reasonType`, never display text —
`lib/league-links/decisionOsActionMap.ts`):

| reasonType | actionable | internal (AF) | external (source) |
|---|---|---|---|
| empty/injured/questionable/doubtful/illegal/native_starter_gap/ai_start_sit | yes | Review Lineup in AF | Set Lineup in {League} |
| ai_waiver | yes | Analyze Waivers in AF | Manage Waivers in {League} |
| injury_impact | yes | Review Recommendation in AF | Manage Roster in {League} |
| war_room | yes | Open War Room in AF | Set Lineup in {League} |
| matchup_prep | no (info) | Review Matchup in AF | — |
| weather_risk, fetch_error | no (info) | — | — |

Manager scope is preserved (this timeline is built only for the user's own teams). A native league shows
the internal AF action but no external one. Commissioner recommendations are a **separate** surface — see
follow-ups.

## Prop-fed dashboard modals — Pending Trades / Waivers / Lineup issues
The three summary modals (`app/dashboard/components/{PendingTradesModal,WaiverRecommendationsModal,LineupIssuesModal}.tsx`)
are **prop-fed from one route**. On the **live** dashboard, `NocturneDashboard` fetches
`GET /api/dashboard/today-actions` once, stores the raw response as `todayFull`, and passes
`todayFull.trades` / `todayFull.waivers` / `todayFull.lineup` straight into the modals (no re-mapping, so
the route's `actionLinks` survive). The legacy `DashboardOverview` wires the same modals identically but is
no longer on the live path. Either way the **route** enriches server-side; no modal fetches its own data or
calls a provider on render.

Per league the route attaches an `actionLinks` bundle (`DecisionOsActionLinks`): the **internal** AF
analysis link (pro-gating unchanged — the existing `ProLeagueLink`), the **secure external** source action
(ungated), and an `imported` flag. Each modal renders internal + external per league/trade and shows the
read-only disclosure **once** in its footer (only when some imported league resolved an external action).

| Surface | enricher | internal (AF) | external (source) |
|---|---|---|---|
| **Pending Trades** (`body.trades.trades[]`) | `buildLeagueActionBundles(action:'trade')` | Analyze Trade in AF | Review Trade in {League} |
| **Waiver Recommendations** (`body.waivers.recommendations[]`) | `buildLeagueActionBundles(action:'waiver')` | Analyze Waivers in AF | Manage Waivers in {League} |
| **Lineup issues** (`body.lineup.leagues[]`) | `enrichLineupBlocksWithLinks` | Review Lineup in AF | derived from issue types → Set Lineup / Manage Roster in {League} |

For lineup blocks the external action is derived from the block's **issue types** (`lineupBlockActionConfig`
— first actionable issue wins, from the normalized type, never display text). External links are resolved
in the route from the canonical `League` row (one `findMany` per surface, keyed by internal `leagueId`) —
never a cached/client/prop URL (the items carry none), never a provider fetch. A homepage-fallback provider
always shows the honest *Go to {provider}* label even if a caller passes a specific-page label.
Native/unknown/missing leagues fail safe: internal action only, no external, no disclosure.

## Live dashboard (Nocturne) — agenda + warnings
The production `/dashboard` renders `components/dashboard/nocturne/NocturneDashboard.tsx` (the Nocturne
cut-over). Its agenda/warning surfaces and how each relates to the secure loop:

| Live surface | What it is | Secure action loop |
|---|---|---|
| **Today's priorities** | compact launcher rows (lineup / waiver / trade) | opens the wired modals (internal + external + disclosure) — the loop completes in the modal |
| **Top outstanding issues** | per-league alert list (lineup + pending-trade rows) | **wired here** — see below |
| **CTA banners** | visitor / free-plan / verify-email / geo-restricted | **no source action** (account / billing / compliance / system — never an imported-league page) |
| **Hero KPIs**, **StatChips** | aggregate counts ("Need attention", "Leagues") | not per-league — no source action |

**Top outstanding issues** (`components/dashboard/OutstandingIssuesCard.tsx`; rows built by
`lib/dashboard/outstanding-issues.ts`): each row is an **internal** AllFantasy launcher — clicking it opens
the same wired modal its normalized `kind` maps to (`lineup` → LineupIssuesModal, `trade` →
PendingTradesModal), so the internal nav keeps its existing pro-gating — **plus** a compact **secure
external** source action for imported + resolvable leagues, and the read-only disclosure **once** under the
card. The external link is **not** resolved here: each row reuses the `actionLinks.external` the route
already resolved server-side from the canonical League row (off `todayFull.lineup.actions[]` /
`todayFull.trades.trades[]`). The row keeps its own canonical `leagueId`, so links stay league-scoped; a
homepage fallback stays honest ("Go to {provider}"); native / unknown / link-less leagues get the internal
launcher only.

### Not on the live path (legacy `DashboardShell` → `DashboardOverview`)
`DashboardShell` is not rendered by any live route (the production `/dashboard` renders `NocturneDashboard`),
so these are **dead code** on production and were **not** wired this batch: `PlatformPulseCard`,
`ActionCenter`, `TodayTimeline`, `DashboardHero`, and `RecommendationTimeline`. Reviving any of them behind
the live dashboard is a separate decision; if revived, `PlatformPulseCard` items already carry a canonical
`leagueId` (except the aggregate `waiver_pickups` / `pending_trades` counts) and could reuse
`resolveSourceLinksForLeagueIds` server-side.

## Follow-up gaps (explicitly not wired here)
These surfaces carry only the internal `leagueId` (+ a platform *label*), not the source
`platformLeagueId` — wiring them needs the resolved link threaded into their payloads (via the server
helper / route enrichment), a cross-cutting change kept out of this focused PR:
- **Decision OS commissioner cards** (`CommissionerHealthCard`, internal Commissioner-Hub links) — a
  separate, commissioner-scoped surface from the manager surfaces wired here.
- **Today's Agenda** (`ActionCenter` / `lib/today-actions-engine`) + the dashboard warning banners, and
  **Chimmy structured action cards** (`ChimmyActionRecommendationCard`).
- **Dashboard league card** (`LeagueHubCard`) — the whole card is a `<button>`, so a nested `<a>` needs a
  small layout change to host the external link outside the button.
- **Player Search** (`PlayerSearchDropdown`) — no `/players` page and no per-result league scope; not
  feasible without threading league context in.

## Acceptance: HailShiva
With a canonical Sleeper `sourceLeagueId`, the resolver returns the **direct** HailShiva league URL
(`https://sleeper.com/leagues/{id}/league`, `destinationType:'league'`, `isFallback:false`), Decision OS
+ actionable surfaces label the button **HailShiva** (e.g. "Fix Lineup in HailShiva"), the league page is
preferred over the homepage, an absent/invalid id falls back to the Sleeper homepage, and **no** import
or provider fetch is triggered by resolving or clicking the AF link.

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

## Follow-up gaps (explicitly not wired here)
These surfaces carry only the internal `leagueId` (+ a platform *label*), not the source
`platformLeagueId` — wiring them needs the resolved link threaded into their payloads (via the server
helper), a cross-cutting change kept out of this focused PR:
- **Decision OS** alerts/recommendation cards (`lib/decision-os/*`, `RecommendationTimeline`) — the
  propagation mechanism (`resolveSourceLinkForLeague`) ships + is tested; the live card render is the
  follow-up.
- **Today's Agenda** (`ActionCenter` / `lib/today-actions-engine`), **Injury & lineup warnings**
  (`LineupIssuesModal`), **Waiver recommendations** (`WaiverRecommendationsModal`), **Chimmy structured
  action cards** (`ChimmyActionRecommendationCard`), **PendingTradesModal**.
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

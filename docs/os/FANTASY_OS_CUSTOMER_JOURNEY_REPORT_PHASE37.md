# Customer Journey Report (Phase 37, Part 2)

## Manager journey: Login → Dashboard → League → Manager Hub → Game Day → Back

| Step | Before this phase | After this phase |
|---|---|---|
| Login → Dashboard | Real, works | Unchanged |
| Dashboard → League | Real (My Leagues list), works | Unchanged |
| League → Manager Hub | **Dead end from NFL/NCAAF's own league page** — no card/link existed; the only exit was the global top nav, itself only visible on non-`/dashboard` pages | Unchanged this phase (Manager OS content is now inline on the league page itself via `UserOsCardConnected`, Phase 36 — arguably reduces the *need* to leave the league page at all for this specific data) |
| Dashboard → Manager Hub | **Dead end** — no entry point existed anywhere on `/dashboard` | **Fixed** — new hero nav chip |
| Manager Hub → Game Day | **Dead end, unavoidably** — no real Game Day surface exists anywhere in the product (Game Day OS is dead code); the closest real equivalent (Matchup Center) is not linked from `/manager-hub` | Disclosed, not fixed — building this link was judged out of the "smallest possible changes" scope, since it would require deciding which league's Matchup Center to link to from a multi-league hub, a real product decision beyond this phase's mandate |
| Back | Standard browser/nav back, works | Unchanged |

## Commissioner journey: Login → Dashboard → League → Commissioner Hub → League Analytics → Mission Control

| Step | Before this phase | After this phase |
|---|---|---|
| Login → Dashboard | Real, works | Unchanged |
| Dashboard → League | Real, works | Unchanged |
| League → Commissioner Hub | Real — `NflRedraftLeagueHomeDashboard.tsx`'s commissioner tiles are static teasers (not live), but the global nav (where visible) and `/dashboard`'s own Commissioner Hub card both provide a real path | Unchanged |
| Commissioner Hub → League Analytics | Real — `LeagueAnalyticsCard` renders inline within `/commissioner-hub`'s League Focus, no separate navigation needed | Unchanged |
| League Analytics → Mission Control | Real — `MissionControlCard` renders inline in the same League Focus section | Unchanged |

## Duplicated information found

- **League health**, computed and displayed independently up to three times per league across a single session (`/dashboard`, `/commissioner-hub`, `/league/[leagueId]/intelligence`) — see Surface Inventory. A commissioner completing the journey above would see three different numeric/qualitative health assessments for the same league without any indication they're different engines.
- **`ManagerDnaCard`/`DecisionRecommendationsCard`/`LeaguePulseCard`** render identically on both `LeagueTab.tsx` (per-league) and `CommissionerHubPageClient.tsx` (`/commissioner-hub`) — the same component, same data, intentional reuse per the underlying code's own comments, not a bug, but a real duplication a user experiences as "I've seen this already."

## Missing cross-links found

- Dashboard → Manager Hub (fixed this phase).
- Manager Hub → any real matchup/live-scoring surface (disclosed, not fixed — no clear "right" target given the multi-league scope).
- NFL/NCAAF's static "Manager Intelligence" teaser tile → the now-real `UserOsCardConnected` section on the same page (disclosed, not fixed — this tile is an entitlement/monetization-gated marketing surface outside this phase's understanding of its business rules; changing it risked violating "do not redesign").

## Inconsistent naming encountered mid-journey

Covered fully in the Naming Consistency Report — a user moving through this journey encounters "Manager Intelligence," "League Intelligence," "Manager Hub," "Manager OS," "Commissioner Hub," "Commissioner Intelligence," "League Health," and "Mission Control" as apparently related but actually only loosely connected concepts.

## Dead ends

- Manager Hub → Game Day (no real target exists platform-wide, not a fixable dead end within this phase's scope).
- AI Coach (`/app/coach`) — reachability from primary nav/current dashboard could not be confirmed; flagged as a likely-orphaned journey entirely, not validated further this phase (would require a dedicated nav-reachability audit, out of scope).

## Unnecessary context switches

A commissioner wanting a full picture of one league's health today must visit up to three different pages/sections (Dashboard's Commissioner HQ card, Commissioner Hub's League Health Map, and `/league/[leagueId]/intelligence`'s Health module) to see three different computations, rather than one authoritative view.

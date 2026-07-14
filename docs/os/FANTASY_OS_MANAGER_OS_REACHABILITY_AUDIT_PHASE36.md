# Manager OS Reachability Audit (Phase 36, Part 1)

Fresh re-verification (not reused from Phase 35) confirmed every prior finding and added precision.

## Tab-id → component → sport map

`getLeagueTabs('NFL')` and `getLeagueTabs('NCAAF')` both return `FOOTBALL_REDRAFT_COMPACT_TABS` — no `league` tab id exists for either sport, in any league variant (redraft-core, dynasty, keeper, bestball, guillotine). The `home` tab (unconditional on sport) renders `NflRedraftLeagueHomeDashboard.tsx` — confirmed via direct grep to have zero Manager OS references before this phase. NBA/MLB/NHL/NCAAB/SOCCER/PGA all get a `league` tab id → `LeagueTab.tsx` → `UserOsCard`.

## NCAAF's exact relationship to NFL

Confirmed: NCAAF (non-dynasty/bestball/guillotine, `leagueType === 'redraft'`) is `nflRedraftCore === true` exactly like NFL, and renders the **identical `NflRedraftLeagueHomeDashboard` component instance** — not a fork. `lib/decision-os/dashboard-intelligence.ts` and every file under `lib/decision-os/behavioral/` have zero `NCAAF`-specific branching or exclusion (grep-confirmed). The Manager OS pipeline is fully sport-agnostic.

## `/manager-hub` and navigation

`lib/navigation/NavLinkResolver.ts`'s `PRIMARY_NAV_ITEMS` is the single source of truth for desktop top nav and the hamburger drawer's candidate pool. Before this phase, no entry existed for `/manager-hub`. `/commissioner-hub` already had one — a real, telling asymmetry.

## Mobile navigation

Two real, separate mobile surfaces: `MobileBottomTabs.tsx` (5 fixed slots: Home/Leagues/War Room/Chimmy/Profile — no Commissioner Hub either) and `MobileNavigationDrawer.tsx` (explicit allowlist filter — Commissioner Hub is excluded from the drawer despite being in `PRIMARY_NAV_ITEMS`). This is a real, load-bearing precedent for this phase's navigation decision.

## Authorization (confirmed safe, no fix needed)

Both `app/api/decision-os/user-os/route.ts` and `app/api/decision-os/manager-command-center/route.ts` hard-scope to the session's own user id server-side — never a client-suppliable parameter. An existing, already-passing test (`user-os-route-contract.test.ts`) already locks this in by asserting a `managerId=someone-else` URL param is ignored in favor of the session id.

## Existing contextual-entry precedent

`LeagueTab.tsx` already has a real, shipped precedent: small launcher cards (`nav-manager-intelligence`, `nav-commissioner-intelligence`) linking to deeper per-league hub pages, feature-flag-gated. Used as the conceptual model (not literally reused code) for this phase's NFL/NCAAF integration.

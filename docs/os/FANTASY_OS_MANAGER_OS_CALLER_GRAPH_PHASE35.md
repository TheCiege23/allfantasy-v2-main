# Manager OS Caller Graph (Phase 35, Track B)

```
lib/decision-os/userOs.ts :: resolveUserOsSnapshot()
  ← app/api/decision-os/user-os/route.ts                    (real, live, session-gated API route)
  ← lib/decision-os/managerCommandCenter.ts                 (called per-league, in parallel)

lib/decision-os/managerCommandCenter.ts :: resolveManagerCommandCenterSnapshot()
  ← app/api/decision-os/manager-command-center/route.ts     (real, live, session-gated API route)

app/api/decision-os/user-os/route.ts
  ← app/league/[leagueId]/tabs/LeagueTab.tsx                (real component)
      ← app/league/[leagueId]/LeagueShell.tsx's tab switch, ONLY for case 'league'
          — 'league' tab id exists ONLY for NBA/MLB/NHL/NCAAB/SOCCER/PGA leagues
          — NFL/NCAAF leagues use 'home' -> NflRedraftLeagueHomeDashboard.tsx instead,
            which has ZERO Manager OS references (confirmed, not assumed)

app/api/decision-os/manager-command-center/route.ts
  ← components/decision-os/ManagerCommandCenterSection.tsx  (real component)
      ← app/manager-hub/ManagerHubPageClient.tsx / page.tsx (real, deployed route)
          ← app/fantasy-os/FantasyOsGateway.tsx (links here under 4 different labels)
              — NOT linked from any primary navigation component anywhere in the app
              — reachable only by direct URL

Shadow / non-real callers:
  lib/validation-cohort/validation/compositionBridge.ts
    — resolveManagerCommandCenterSnapshot appears only as a STRING LABEL in a
      "blocked-product-state" table entry, explicitly documenting it is NOT executed
      by the validation bridge. Not a real import.

Script-only:
  scripts/decision-os-manager-os-live-validate-nonprod.ts
    — manual CLI, requires --userId, refuses to run against the production host,
      no assertions/pass-fail gate, not wired into CI (no .github/workflows/ found
      referencing it). Demonstrates the pipeline CAN run against real data; does not
      constitute an automated or repeatable validation gate.

Test-only:
  __tests__/decision-os/manager-command-center*.test.{ts,tsx} (7 files)
    — all confirmed mocked unit/contract tests or static source-scans
      (e.g. league-tab-user-os-wiring.test.ts literally regex-scans LeagueTab.tsx's
      source text rather than rendering/executing anything — it does NOT verify the
      sport-conditional LeagueShell.tsx wiring that actually gates reachability)
```

## Reading this graph

Unlike Commissioner OS (zero real callers, confirmed dead code), Manager OS **is** genuinely wired into two real, executing production paths. But both paths have a real reachability gap not discussed in prior documentation: one is sport-conditional and excludes the platform's primary sports (NFL/NCAAF); the other is orphaned from primary navigation. Neither gap is a code defect — the code that exists is real and would execute correctly if reached — but "wired into a real route" and "reachable by a normal user in the platform's primary product" are different claims, and prior "OS-C" documentation did not distinguish them.

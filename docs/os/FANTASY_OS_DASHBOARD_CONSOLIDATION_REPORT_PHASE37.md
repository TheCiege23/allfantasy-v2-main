# Dashboard Consolidation Report (Phase 37, Part 5)

Per the guardrail ("do not redesign any OS subsystem... smallest possible changes"), exactly one implementation change was made this phase, targeting the single highest-value, lowest-risk real gap found.

## Change made: Manager Hub entry point on `/dashboard`

**Problem (real, previously undetected):** `/dashboard` explicitly hides the global top navigation (`app/dashboard/layout.tsx`'s `hideHeader`), using its own in-shell nav-chip row instead (`DashboardHero.tsx`). Commissioner Hub already had a chip there; Manager Hub — despite being a real, live, Phase-36-validated feature relevant to every user, not just commissioners — had none. Phase 36's own primary-navigation fix was real and correct but invisible from the app's actual primary landing page.

**Fix:** Added one new `NavChip` to `DashboardHero.tsx`, reusing the exact existing component (same visual pattern as the adjacent War Room and Commissioner Hub chips), linking to `/manager-hub`, shown unconditionally to every signed-in user (not gated by commissioner status, since Manager OS content is relevant to everyone). Added the new translation key across all 5 existing locales (English, Spanish, Chinese, Filipino, Vietnamese), following each locale's own established translation style for the adjacent "Commissioner Hub" key.

## Changes deliberately NOT made (scope discipline)

- **The three-way League Health duplication** (Intelligence Capability Map's top finding) was not touched — resolving it would require either picking one authoritative engine (an OS-subsystem-redesign-adjacent decision explicitly forbidden this phase) or adding disambiguating UI copy across three separately-owned pages, which alone would exceed "smallest possible changes" given the number of surfaces involved. Documented as the top recommendation for a future, explicitly-scoped phase.
- **NFL/NCAAF's static "Manager Intelligence"/"League Intelligence" teaser tiles** were not cross-linked to the now-real `UserOsCardConnected` section on the same page. These tiles are entitlement/monetization-gated marketing surfaces; their exact business logic (what "Pro"/"Supreme" unlocks, how the upsell funnel is supposed to work) was not something this phase had full context on, and modifying a monetization surface without that context risked violating both "do not redesign" and basic product-safety judgment. Disclosed, not fixed.
- **No duplicate-card removal.** Every duplication found (`ManagerDnaCard`/`DecisionRecommendationsCard`/`LeaguePulseCard` appearing on 2+ pages) was confirmed via source comments to be *intentional, already-documented* reuse of the same real data — not a bug, and removing a card from one of its two real pages would be a product decision (reduce information density on that page) beyond a "cohesion" fix.
- **No renaming.** Per the explicit guardrail, naming inconsistencies are documented in the Naming Consistency Report as recommendations only.

## Discoverability improvement, measured

Before this phase: a user landing on `/dashboard` (the app's actual entry point after login) had zero way to discover Manager Hub except by already knowing the URL or navigating to a non-dashboard page first. After this phase: one click from the primary landing page, using the exact same interaction pattern (`NavChip`) users already know from the adjacent War Room and Commissioner Hub chips.

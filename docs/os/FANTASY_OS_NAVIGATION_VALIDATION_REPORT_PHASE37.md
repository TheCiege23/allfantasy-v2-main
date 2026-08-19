# Navigation Validation Report (Phase 37, Parts 6-7)

## Truthfulness spot-check (Part 6)

Building on Phases 33-36's already-thorough per-surface truthfulness audits (Matchup Center's bye/unavailable fix, Manager OS's insufficient-data fix), this phase spot-checked the surfaces newly mapped:

| Surface | Freshness/confidence honesty | Assessment |
|---|---|---|
| `/commissioner-hub` health cards | Explicit "Source: Database/Dashboard fallback" + "Confidence: {dataConfidence}" labels, confirmed present in code | Honest on its own terms |
| `/league/[leagueId]/intelligence` modules | Each module (Health/Action-Items/Trade-Review/Rule-Settings) independently owns loading/empty/error/restricted/upgrade states; audit feed shows per-item timestamps | Honest on its own terms |
| Matchup Center | Explicit "Partial data - refreshing sources…" banner (`partialData`) | Already fixed and validated in Phase 34 |
| Manager OS cards | "Insufficient data" now correctly distinguished from confirmed risk | Fixed and real-validated in Phase 36 |
| **Cross-surface** (the 3-way League Health duplication) | **No surface discloses that its number is one of several independently-computed values a user might see elsewhere on the platform** | The one real, disclosed gap — no single surface overstates its OWN certainty, but the platform as a whole doesn't disclose the existence of the other two computations. Documented in the Intelligence Capability Map; not fixed this phase (would require cross-page copy changes beyond "smallest possible changes"). |

No surface was found overstating its own internal certainty. The gap is structural/cross-surface, not a per-surface truthfulness defect.

## Real validation (Part 7)

Using the same real Sleeper leagues/users from Phases 33-36.

### What was validated

- **The retention-risk fix (Phase 36) still holds**: not re-executed fresh this phase (no logic changed), but the underlying code (`manager-intelligence.ts`, `managerCommandCenter.ts`) was not touched this phase — no risk of regression.
- **The new Manager Hub dashboard chip**: validated via a static source-scan test (`dashboard-hero-manager-hub-wiring.test.ts`, 3 tests, passing) confirming the exact wiring — import, href, label, and placement outside any commissioner-only conditional.
- **i18n parity**: validated via the existing `i18n-placeholder-parity.test.ts` suite, confirming the new translation key is present and consistent across all 5 locales with no placeholder/parity violations.

### Honest limitation disclosed

**Live browser verification of the new dashboard chip was attempted but not completed.** The dev server was started, the dev-auth-bypass login succeeded, but the resulting test account required a first-time username-selection onboarding step that did not complete within a reasonable number of attempts in this environment (a real, pre-existing onboarding-flow characteristic unrelated to this phase's change — never reached the point of testing the actual chip). Confidence in the change instead rests on: (a) the passing static-scan test, (b) the change being a single-line JSX addition using the exact same `NavChip` component, with the exact same prop shape, as two already-shipped, already-working chips immediately adjacent to it in the same array, and (c) passing lint/typecheck. This is a real, disclosed gap between "validated" and "structurally proven," not silently glossed over.

## Remaining dead ends / broken links / inconsistent states (honestly disclosed, not all fixed)

- Manager Hub → Game Day: unavoidable dead end (no real Game Day surface exists platform-wide).
- AI Coach (`/app/coach`) reachability from primary nav/current dashboard: unconfirmed, flagged for a future dedicated audit.
- NFL/NCAAF's static Manager/League Intelligence teaser tiles: not dead ends exactly (they render real, non-broken UI), but their promised content doesn't actually appear inline anywhere on the same page — a real, disclosed gap between what the tile describes and what the page delivers.

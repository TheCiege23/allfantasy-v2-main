# G22 - Product Polish Phase 1

Theme System, Design Foundation & Launch Readiness

Date: 2026-07-01

Readiness hold:

- NFL Engine: 93%
- Overall Platform: 90%

No readiness increase is recommended from this audit/foundation pass alone.

## Executive Summary

AllFantasy has the start of a shared theme system, but the product is not yet visually unified. The global CSS already defines `light`, `dark`, `legacy`, and `system` behavior through `data-mode`, and several shared UI primitives use CSS variables. At the same time, many customer-facing and admin surfaces still hardcode dark-mode Tailwind classes, arbitrary hex colors, gradients, borders, shadows, rounded radii, and placeholder-style states.

G22 should be treated as a design-system migration, not a page-by-page repaint. The correct path is to keep business logic untouched, finish the global foundation, migrate shared primitives, then move high-traffic surfaces onto those primitives.

## Audit Scope

Audited source areas:

- `app`
- `components`
- `components/ui`
- `components/theme`
- `lib/theme`
- `lib/preferences`
- `tailwind.config.js`
- `app/globals.css`
- G21 browser smoke results and customer-facing blocker notes

Inventory:

- 299 app route pages.
- 8 route-level `loading.tsx`, `error.tsx`, or `not-found.tsx` files.
- 17 shared UI primitive files in `components/ui`.
- Approximately 28,458 color-related source matches across `app` and `components`.
- Approximately 4,694 gradient, oversized-radius, placeholder, beta, loading, or generic-error polish matches across `app` and `components`.

## 1. Theme System

Current architecture:

- `components/theme/ThemeProvider.tsx` owns client mode state.
- `lib/theme/constants.ts` defines `light`, `dark`, `legacy`, and `system`.
- `lib/preferences/HtmlPreferenceSync.ts` applies effective mode to `html[data-mode]`.
- `app/layout.tsx` applies `mode-readable` and inline `var(--bg)` / `var(--text)` root styling.
- `app/globals.css` provides the primary variable layer and light-mode rescue rules.

Findings:

| Area | Status | Finding | Impact |
| --- | --- | --- | --- |
| Light mode | Partially working | Light mode relies on broad rescue selectors for dark Tailwind classes. | Prevents predictable, premium polish and can over-correct nested surfaces. |
| Dark mode | Partially working | Many pages are authored directly in dark-only classes instead of tokens. | Dark mode looks more complete, but it is not truly system-driven. |
| System mode | Working foundation | System mode resolves to light/dark through `matchMedia`. | Good foundation, but components must stop hardcoding colors. |
| Legacy mode | Working but special-case heavy | Legacy uses separate variable overrides and many specialty mode tokens. | Useful brand mode, but it increases test surface. |
| Focus states | Inconsistent | Shared `Input` has variable-adjacent focus, many custom inputs do not. | Accessibility and keyboard trust risk. |
| Cards/surfaces | Inconsistent | `Card` uses variables; many page cards use `bg-black/`, `bg-white/`, or arbitrary hex. | Visual drift and contrast inconsistency. |

G22 foundation work completed:

- Added semantic tokens to `app/globals.css` for surfaces, text, borders, brand, status, Decision OS, Commissioner, shadows, focus rings, typography, and spacing.
- Added utility classes: `af-surface`, `af-card`, `af-card-soft`, `af-control`, `af-badge`, `af-button-primary`, `af-button-secondary`, `af-focus-ring`.
- Added semantic Tailwind colors in `tailwind.config.js`: `surface`, `content`, `brand`, `status`, and `line`.
- Migrated shared `components/ui/button.tsx` away from hardcoded cyan/purple default styling to semantic theme classes.

## 2. Color System

Current colors exist in three layers:

1. CSS variables in `app/globals.css`.
2. Tailwind extensions for `neon` and `dark`.
3. Component/page-level hardcoded colors.

Core issue:

The app has tokens, but they are not yet the required path. Components can still bypass the design system freely.

Recommended canonical semantic tokens:

| Category | Token family |
| --- | --- |
| App surfaces | `surface-app`, `surface-card`, `surface-card-soft`, `surface-inset`, `surface-hover`, `surface-overlay` |
| Text | `content-primary`, `content-secondary`, `content-tertiary`, `content-inverse` |
| Brand | `brand-primary`, `brand-strong`, `brand-soft`, `brand-secondary`, `brand-accent` |
| Status | `status-success`, `status-warning`, `status-danger`, `status-info` |
| Decision OS | `brand-decision`, `--color-decision-soft` |
| Commissioner | `brand-commissioner`, `--color-commissioner-soft` |
| Borders | `line-subtle`, `line-strong` |

Migration rule:

New UI should not use direct `text-white`, `bg-black`, `border-white`, arbitrary dark hexes, or product-specific gradients unless it is a deliberately branded hero or league-format skin.

## 3. Typography

Findings:

- Global body font is `18px` with `line-height: 1.6`, but many components override to `text-[8px]`, `text-[9px]`, `text-[10px]`, and tight uppercase labels.
- Tables, dense dashboards, and draft-room controls use many custom micro sizes.
- Hero, card, modal, and dashboard headings do not share a common scale.

Recommended scale:

| Role | Token |
| --- | --- |
| Caption | `--font-size-caption` |
| Body small | `--font-size-body-sm` |
| Body | `--font-size-body` |
| Small title | `--font-size-title-sm` |
| Title | `--font-size-title` |
| Display | `--font-size-display` |

Implementation path:

Create shared `Text`, `PageTitle`, `SectionTitle`, and `MetricLabel` primitives only after the first component migration proves the scale.

## 4. Spacing

Findings:

- Page padding ranges from `px-3` to `px-8` without a route-level standard.
- Cards use mixed `rounded-lg`, `rounded-xl`, `rounded-2xl`, and `rounded-3xl`.
- Toolbars and modals use inconsistent gaps and button heights.
- Some dense fantasy surfaces need compact spacing, but the current density is accidental rather than systemized.

Foundation tokens added:

- `--space-1` through `--space-10`.

Recommended defaults:

- Page shell: `px-4 sm:px-6 lg:px-8`.
- Card radius: 8-12px for operational UI.
- Modal radius: 12-16px.
- Button/control minimum height: 44px.
- Dense tables: compact row height allowed, but tap targets must remain accessible on mobile.

## 5. Component Audit

Shared primitives currently present:

- Button
- Card
- Input
- Select
- Dialog
- Popover
- Command
- Calendar
- Switch
- Table
- Textarea
- Label
- Badge
- Skeleton
- AppModal
- AdminCard
- Legacy UI wrapper

Findings:

| Component area | Status | Finding |
| --- | --- | --- |
| Buttons | Improved in G22 | Shared Button now uses semantic tokens, but many pages still use custom button classes. |
| Cards | Partially centralized | Shared Card is tokenized; many pages do not use it. |
| Inputs | Partially centralized | Shared Input is tokenized; many custom dark inputs remain. |
| Tables | Needs audit | Admin, standings, roster, and matchup tables use independent wrappers. |
| Badges | Fragmented | Status, Beta, Coming Soon, roster, and ranking badges duplicate color logic. |
| Dialogs/popovers | Mixed | Shared primitives exist, but feature-specific overlays frequently bypass them. |
| Charts/progress | Fragmented | Color semantics are embedded in components instead of chart tokens. |

Highest-value consolidation:

1. Button variants.
2. Card/surface primitives.
3. Form field primitives.
4. Badge/status primitives.
5. Empty/loading/error state primitives.
6. Data table shell.
7. Decision OS evidence card.

## 6. Decision OS

Findings:

- Decision OS and AI surfaces use many visually rich dark patterns, but visual trust is inconsistent.
- Evidence/confidence/freshness affordances are not guaranteed across all visible intelligence cards.
- AI-related components often look “exciting” before they look auditable.

Design requirement:

Decision OS should feel like a command-grade intelligence layer:

- Deterministic evidence first.
- Confidence and source count visible.
- Insufficient-data state explicit.
- AI narrative visually secondary to facts.
- Recommendations grouped by actionability and risk.

Required shared components:

- `DecisionInsightCard`
- `EvidenceList`
- `ConfidenceBadge`
- `DataFreshnessLabel`
- `InsufficientDataState`

## 7. Commissioner Experience

Findings:

- Commissioner Hub has visible Beta labels, but settings/control surfaces still vary in hierarchy.
- Draft, waivers, trades, schedule, and playoffs each have their own control language.
- Confirmation and audit feedback are not yet standardized.

Polish goals:

- Reduce repeated decisions.
- Make dangerous actions visibly distinct.
- Standardize confirmation copy.
- Always show whether a setting is enforced, beta, future, or cosmetic.
- Move commissioner actions into consistent primary/secondary/danger action patterns.

## 8. Manager Experience

Findings:

- Dashboard and league surfaces now have some trust affordances from G21B.
- Roster, matchups, players, waivers, trades, live scoring, and Decision OS still need a unified “next best action” pattern.
- Many tools show data but do not yet answer the manager’s next question.

Required pattern:

Every manager-facing operational screen should expose:

- Current status.
- Next deadline/action.
- Top recommendation.
- Evidence/freshness.
- Empty/loading/error state that explains what happens next.

## 9. Mobile

Findings:

- G21B/G21C browser smoke restored landing, dashboard, and draft-room coverage.
- Many tables rely on horizontal scrolling.
- Numerous components use tiny labels and controls under 44px.
- Mobile coverage does not yet span the full critical path.

Critical mobile pass needed:

1. Landing and auth.
2. Dashboard.
3. League home.
4. Roster/team.
5. Matchups/live scoring.
6. Players/waivers.
7. Trades.
8. Draft room.
9. Commissioner Hub/settings.
10. Decision OS/Chimmy.

## 10. Accessibility

Findings:

- Focus states are inconsistent outside shared primitives.
- Light mode rescue rules protect readability but do not guarantee contrast.
- Several custom controls are button-like `div`/unstyled controls in older surfaces.
- Motion and animation are not consistently gated by reduced-motion preferences.
- Error/loading states are inconsistently announced.

Required improvements:

- Shared focus ring using `--focus-ring`.
- Tokenized contrast checks for all semantic colors.
- Keyboard pass on menus, dialogs, tabs, drawers, and draft-room controls.
- `prefers-reduced-motion` treatment for decorative animation.
- ARIA and live-region pass for loading/error/async action states.

## 11. Empty, Loading, and Error States

Findings:

- Only 8 route-level loading/error/not-found files exist across 299 pages.
- Generic copy still appears: `Loading...`, `Something went wrong`, technical `Error:` prefixes, and placeholder-only panels.
- Some empty states are helpful, but there is no shared contract.

Shared state components needed:

- `EmptyState`: why empty, what happens next, primary action.
- `LoadingState`: skeleton plus meaningful loading copy.
- `ErrorState`: what happened, why, what to do, retry/back actions.
- `DegradedDataState`: source unavailable, last successful sync, next retry.

## 12. Animation

Findings:

- Many surfaces use glow, pulse, gradient, and hover-scale patterns.
- Some animations support brand energy, but repeated motion risks making operational workflows feel less serious.

Rules:

- Motion should indicate state change, progress, hierarchy, or feedback.
- Avoid decorative perpetual motion in dense tools.
- Add reduced-motion fallbacks before broad visual rollout.

## 13. Launch Polish Findings

High-confidence launch polish blockers:

| Severity | Area | Finding | Recommended fix |
| --- | --- | --- | --- |
| P0 | Theme system | Too many hardcoded dark colors bypass tokens. | Migrate shared primitives and critical routes to semantic tokens. |
| P0 | State handling | Route-level loading/error coverage is thin. | Add shared state components and apply to critical path. |
| P0 | Mobile | Critical path is not fully browser-proven. | Expand Playwright smoke across customer launch flow. |
| P0 | Decision OS trust | Evidence/confidence not universally surfaced. | Create shared evidence/freshness UI and migrate visible cards. |
| P1 | Component duplication | Buttons/cards/inputs/badges duplicated across pages. | Replace with shared primitives in priority surfaces. |
| P1 | Commissioner trust | Settings/action states vary by workflow. | Standardize enforced/beta/future labels and action confirmations. |
| P1 | Typography | Micro text and heading scales are inconsistent. | Adopt token scale route by route. |
| P2 | Animations | Decorative motion is inconsistent. | Motion audit plus reduced-motion defaults. |

## Screens Requiring Redesign

These surfaces likely need structural redesign, not just token replacement:

- Legacy AF import/analyzer surfaces under `app/af-legacy`.
- Decision OS / AI tool dashboards that present recommendations without consistent evidence hierarchy.
- Commissioner settings and multi-engine control flows.
- Dense draft-room control panels after the harness is stable.
- Admin production-health dashboard if intended for ongoing operations.
- Older specialty league shells for Zombie, Survivor, C2C, Devy, IDP where mode skins bypass global tokens.

## Screens Requiring Polish Only

These surfaces appear closer to launch shape and should be migrated, not redesigned:

- Landing page.
- Dashboard.
- Current League Shell tabs.
- Commissioner Hub.
- Draft Room core shell.
- Auth entry pages.
- Basic legal/data pages.

## Prioritized Implementation Roadmap

### Stage 1 - Foundation Lock

Effort: 2-4 days.

- Finish semantic tokens.
- Wire Tailwind semantic colors.
- Migrate `Button`, `Card`, `Input`, `Select`, `Dialog`, `Badge`, `Table`, `Skeleton`.
- Add shared state components.
- Add reduced-motion global rules.
- Add source lint/test for new hardcoded colors in shared primitives.

### Stage 2 - Critical Route Migration

Effort: 5-8 days.

- Landing/auth/dashboard.
- League home/team/roster/matchups.
- Players/waivers/trades.
- Draft room.
- Commissioner Hub/settings.
- Decision OS/Chimmy visible cards.

### Stage 3 - Mobile and Accessibility Proof

Effort: 4-6 days.

- Browser smoke for launch path at desktop and mobile viewports.
- Keyboard pass for menus, dialogs, tabs, drawers.
- Contrast audit for semantic tokens.
- State audit for empty/loading/error/degraded views.

### Stage 4 - Specialty Format Skins

Effort: 5-10 days.

- Bring Dynasty, Keeper, Best Ball, Guillotine, Survivor, Tournament, Big Brother, Zombie, Devy, C2C, and IDP skins onto plugin/theme extension tokens.
- Keep format identity, but remove dark-only assumptions from shared UI.

## Foundation Work Completed In G22

Files changed:

- `app/globals.css`
- `tailwind.config.js`
- `components/ui/button.tsx`

What changed:

- Added the semantic design-token layer.
- Added utility classes for surfaces, controls, badges, buttons, and focus rings.
- Exposed semantic theme colors to Tailwind.
- Migrated shared Button variants to semantic tokens.

What did not change:

- No business logic.
- No APIs.
- No scoring, league, draft, waiver, trade, schedule, playoff, or Decision OS calculations.
- No page-specific redesign.

## Verification

Verification run after this foundation step:

```text
cmd /c npx vitest run __tests__/chimmy-theme-readability.test.tsx __tests__/required-public-media-assets.test.ts
```

Result: 2 files passed, 5 tests passed.

```text
cmd /c npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

Result: 11 browser tests passed.

Known local dev noise still present:

- NextAuth client-fetch logs from mocked/null auth sessions.
- Meta CAPI errors from local placeholder Meta configuration.
- Occasional Next dev `ECONNRESET`/aborted logs after browser contexts close.

These did not fail the G22 verification runs, but they remain launch-polish noise to address in a later cleanup pass.

Readiness remains unchanged until the full polished experience is implemented and browser-proven.

## G22 Phase 2 - Theme Enforcement Migration

Scope completed:

- Added Tailwind aliases for the Phase 2 semantic vocabulary: `bg-app`, `bg-surface`, `bg-surface-muted`, `text-primary`, `text-secondary`, `text-muted`, `border-subtle`, `ring-focus`, and `shadow-soft`.
- Added shared utility classes for `card-premium`, `glass-panel`, and semantic badge tones.
- Migrated shared `Card` and `Badge` primitives from legacy panel/cyan-purple styling to semantic tokens.
- Migrated dashboard overview, onboarding checklist, connected league cards, active leagues, profile/account, momentum, and strategy shortcut panels.
- Migrated League Home quick cards, rules summary, activity feed, members preview, settings summary, scoring summary, and hero stat cards.
- Migrated Team/Roster bottom sheets, replacement picker, header controls, neutral empty states, and drawer/modal surfaces.

Hardcoded styles removed:

- Replaced dark-only panel backgrounds such as `bg-[#0c1224]`, `bg-[#0b1120]`, `bg-[#121826]`, and `bg-[#1e2436]` on migrated dashboard and league-home cards.
- Replaced neutral `text-white/*`, `border-white/*`, and `bg-white/*` usage on migrated customer-facing panels with semantic text, border, and surface classes.
- Replaced several stale visible mojibake strings in migrated dashboard, league-home, and roster surfaces with proper punctuation or ASCII fallback text.

Intentional hardcoded styles left in place:

- League hero media overlay text and black scrims remain hardcoded for readability over video/image backdrops.
- Sport/position/status colors remain hardcoded where they communicate football position, kicker/defense grouping, live score flashes, injury/status, or scoring deltas.
- Scoring-difference highlight color remains explicit because it communicates non-standard scoring.
- Skeleton placeholders and deeper row-level roster styling remain for a later pass where behavior and live-score contrast can be audited together.

Before/after risk notes:

- The highest-risk white-on-white/black-on-black exposure was in neutral app chrome; those surfaces now resolve through the semantic theme layer.
- Shared primitive migration increases blast radius, but the changes preserve component APIs and avoid business logic.
- The League Home hero remains partially dark/media-specific by design; migrating that fully needs a media readability pass, not a token-only change.
- Team/Roster was intentionally bounded to modal/header/control surfaces to avoid disturbing live roster row behavior.

Verification run after Phase 2:

```text
cmd /c npx vitest run __tests__/chimmy-theme-readability.test.tsx __tests__/required-public-media-assets.test.ts
```

Result: 2 files passed, 5 tests passed.

```text
cmd /c npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

Result: 11 browser tests passed. The first local attempt hit the shell timeout before reporting; the rerun completed successfully in about 6.1 minutes.

Additional note:

- A full `cmd /c npx tsc --noEmit --pretty false` sanity check was attempted, but the repo-scale TypeScript run exhausted the Node heap locally before returning type results. The required focused Vitest and Playwright smoke runs passed.
- A targeted TypeScript TSX parse check was run against `DashboardContent.tsx`, `LeagueTab.tsx`, and `TeamTab.tsx` after the visible-copy cleanup; no parse diagnostics were reported.

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

## G22 Phase 3 - Remaining High-Traffic Theme Migration

Scope completed:

- Migrated shared high-traffic primitives used by modals, forms, tables, and loading states: `AppModal`, `Select`, `Switch`, `Input`, `Textarea`, `Dialog`, `Table`, and `Skeleton`.
- Migrated Matchup Center neutral panels, headers, week selector, AI insight cards, starter rows, and start/sit modal content onto semantic surfaces and text tokens.
- Migrated Commissioner Hub page shell, health dashboard cards, metric tiles, mission queue neutral card, migration cards, member-league cards, empty state, trust copy, and secondary actions onto semantic tokens.
- Migrated Settings shell/chrome/loading/error states plus standalone Security and Sleeper connection pages from hardcoded dark shells to `bg-app`, `bg-surface`, `bg-surface-muted`, `text-primary`, `text-secondary`, `text-muted`, `border-subtle`, and semantic focus/hover states.
- Cleaned visible mojibake in migrated Settings and Commissioner Hub metadata/copy where it was customer-facing.

Intentional hardcoded styles preserved:

- Commissioner Hub amber/cyan/violet/emerald accent states remain explicit because they convey setup risk, AI, migration, and commissioner-status meaning.
- Matchup Center live scoring, win probability, start/sit, AI confidence, and team/status colors remain explicit because they encode fantasy state.
- Modal overlays keep black scrims for readability and background separation.
- Settings avatar gradients, user-selected accent swatches, destructive delete button colors, Discord/Spotify brand colors, and connected-account brand colors remain hardcoded by design.
- Draft Room still keeps most cinematic board/war-room gradients and sport/draft-state colors; Phase 3 improved shared modal/form primitives used by draft flows rather than redesigning the room.

Remaining unmigrated surfaces:

- Dedicated Chimmy/AI workbench and legacy AI interface cards still need a deeper pass so deterministic confidence/risk colors remain intact.
- League-specific settings subpanels under format/plugin folders still contain intentional and legacy hardcoded colors; they should be migrated with plugin-theme boundaries rather than by blind replacement.
- Waiver/trade/player surfaces remain candidates for the next polish pass.
- Some legacy UI primitives remain in `components/ui/legacy-ui.tsx`; they are intentionally deferred until consumers are mapped.

Known risks:

- Commissioner Hub had a brief local encoding cleanup mistake during migration; the file was repaired and a targeted TSX parse check passed after repair.
- Full repo `tsc --noEmit` was not rerun in Phase 3 because the previous Phase 2 full check exhausted the local Node heap; Phase 3 relied on targeted TSX parse checks plus required Vitest and browser smoke.
- Optional matchup browser tests expose an existing `/e2e/matchups` harness-route gap. The failures occur on a 404 before migrated Matchup Center UI assertions run.

Verification run after Phase 3:

```text
cmd /c node -e "<targeted TSX parse check>"
```

Result: no parse diagnostics for migrated shared primitives, Settings files, Commissioner Hub, and `components/matchup-center/*.tsx`.

```text
cmd /c npx vitest run __tests__/chimmy-theme-readability.test.tsx __tests__/required-public-media-assets.test.ts
```

Result: 2 files passed, 5 tests passed.

```text
cmd /c npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

Result: 11 browser tests passed in about 6.8 minutes. The same local noise remains: blocked GTM/Meta browser requests, NextAuth client-fetch logs, local Meta CAPI placeholder errors, and Next dev aborted/`ECONNRESET` logs after browser contexts close.

Additional matchup smoke:

```text
cmd /c npx playwright test e2e/matchups-tab-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

Result: failed before UI assertions because `/e2e/matchups?leagueId=...` returned the app 404 page and the expected `E2E Matchups Harness` heading was absent.

```text
cmd /c npx playwright test e2e/matchup-simulator-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```

Result: 1 standalone simulator test passed; the suite then failed on the same `/e2e/matchups` harness 404 before league matchup detail assertions, and the final test did not run.

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

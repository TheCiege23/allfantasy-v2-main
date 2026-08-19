# Visual OS V1 — Surface Audit (Phase V1.0, Step 1)

Audit of the customer-facing Commissioner OS and Manager OS surfaces before any redesign work, per the
phase's own "audit before coding" instruction. Findings below are all verified directly — either by
reading the real component source, or (for the 2 contrast bugs) by live browser inspection of computed
CSS on the actual dev server, not by visual impression alone.

## Surfaces inspected

`/commissioner-hub` (`CommissionerHubPageClient.tsx` + `CommissionerShowcasePanel.tsx` +
`components/decision-os/*`), `/manager-hub` (`ManagerHubPageClient.tsx` +
`ManagerCommandCenterSection.tsx`), and all 16 `components/decision-os/` card components (Multi-League
Overview, Today's Brief, Attention Queue, Notification Center, League Health Ranking, League Switcher,
Priority Modules, League Context, Mission Control, League Analytics, User OS, League Pulse, Manager DNA,
Decision Recommendations), plus the shared primitives file (`DecisionOsCardPrimitives.tsx`) and the
app's design-token layer (`app/globals.css`, `tailwind.config.js`).

## Finding 1 (real, verified) — two competing visual languages on the same page

`components/decision-os/*` already has a real, working shared primitive system:
`decisionOsCardClassName` (built on the app-wide `.card-premium` shell, which itself resolves to
theme-aware CSS variables — `var(--surface-card)`, `var(--border-subtle)`, `var(--text-primary)`), plus
`DecisionOsBadge`, `DecisionOsPanel`, `DecisionOsEmptyState`, `DecisionOsConfidenceBadge`,
`DecisionOsEvidenceGrid`, `DecisionOsTrustNote`, `DecisionOsWhyPanel`, `DecisionOsInsufficientDataCallout`,
`DecisionOsUpdatedStamp`. `CommissionerCommandCenterSection.tsx` / `ManagerCommandCenterSection.tsx` (the
Multi-League Overview) and most of the individual cards (League Analytics, User OS, Manager DNA, Decision
Recommendations) build on this consistently.

But `CommissionerHubPageClient.tsx` — the page these Decision OS cards are embedded IN — predates this
system and never migrated onto it. It defines its own one-off visual language per section: a hero with a
hardcoded amber/cyan gradient, `StatCard`/`MetricTile` components with inline `accentClass`/`borderClass`
props, a violet-gradient "Commissioner AI Prompts" grid, an emerald-gradient "Migration Center" grid, and
`CommissionerShowcasePanel` (a full dark-navy-gradient "island" — see Finding 3). None of these route
through `decisionOsCardClassName` or the app's semantic color tokens; each reinvents its own card shell
and its own ad hoc `amber-500`/`cyan-500`/`emerald-500`/`violet-500` palette. The result, confirmed live
in browser: a page that reads as roughly 6 visually distinct sub-products bolted together rather than one
coherent command center — the exact "collection of disconnected AI cards" problem this phase names.

`ManagerHubPageClient.tsx`, by contrast, is clean: built fresh in OS-C1 with zero legacy content, it is
just a minimal hero plus `ManagerCommandCenterSection`, entirely on shared primitives already.

## Finding 2 (real, verified) — duplicated tone/severity color logic across 4 components

An Explore-agent pass over all 16 `components/decision-os/` files (cross-checked directly) found the
same "map a severity/status/priority level to a border+background+text color triad" logic hand-rolled
independently in 4 places, each with its own local color table:
- `MissionControlCard.tsx` — `overallStatusClass` record (emerald/amber/rose)
- `LeaguePulseCard.tsx` — `toneClass` record + a separate `statusClasses()` function (emerald/amber/rose)
- `DecisionRecommendationsCard.tsx` — `priorityClass()` function (rose/amber/cyan)
- `CommissionerAttentionQueue.tsx` — inline severity-to-border/background mapping (rose/orange/amber/sky/emerald)

`DecisionOsCardPrimitives.tsx` already has `SEVERITY_DOT_CLASS` (a severity→dot-color map) but nothing
that produces a full badge/card-tone treatment — so each component re-derives its own version of the same
concept instead of sharing one. `CommissionerHubPageClient.tsx` has 2 more independent copies of the same
pattern (`HEALTH_STATUS_CLASSES`, `ACTION_TONE_CLASSES`, `MIGRATION_STATUS_CLASSES`).

## Finding 3 (real, verified live via browser + computed CSS) — a genuine light-mode legibility bug

`CommissionerShowcasePanel.tsx` ("Platform Readiness Snapshot") hardcodes a dark background
(`bg-gradient-to-br from-violet-500/[0.08] via-[#08101f] to-cyan-500/[0.04]`) and white/opacity text
(`text-white`, `text-white/78`, `text-white/55`, etc.) regardless of the user's theme. The app defaults to
**light mode** (`:root` in `globals.css` sets `--bg: #F7F8FB`, `--panel: #FFFFFF`), and this app has an
existing global accessibility guard for exactly this situation:
```css
html[data-mode="light"] .mode-readable [class*="text-white"] { color: var(--text) !important; }
```
This guard forces any `text-white*` class back to near-black in light mode — necessary elsewhere, but it
only touches `color`, not `background`. The panel's *background* stays dark navy while its *text* gets
force-flipped to near-black, producing near-black-on-near-black text. Verified live: navigated to
`/commissioner-hub` in light mode (the default), inspected the panel's own `<h2>` — computed
`color: rgba(2, 6, 23, 0.92)` (i.e. `var(--text)`, near-black) against a dark-navy gradient background.
Screenshot confirms card values like "Preview ready" / "17,257" / the panel headline are genuinely hard to
read. **This is a real accessibility defect on the flagship candidate page, not a style preference.**

## Finding 4 (real, verified live via browser + computed CSS) — a second, unrelated contrast bug

Independently of Finding 3: the hero's "Presentation-safe preview" callout
(`CommissionerHubPageClient.tsx`) uses `text-cyan-200/75` on a `bg-cyan-500/[0.08]` background. Verified
live: computed color is `rgba(165, 243, 252, 0.75)` — a light cyan meant for a dark background — rendered
on a near-white/light-cyan-tinted card in light mode. Not covered by the `mode-readable` guard (which only
matches `text-white*`). Confirmed via screenshot on both desktop and mobile viewports: the callout body
text is close to unreadable.

## Finding 5 (real) — redundant league-list/status renderings on one page

`CommissionerHubPageClient.tsx` renders the commissioner's own league list, each with its own status
badge, in **3 different visual treatments** on the same page: (1) `CommissionerLeagueSwitcher` inside the
Multi-League Overview, (2) per-league `<article>` cards inside `LeagueHealthDashboard`, and (3) the
"Leagues I Manage" grid (`resolveSetupStatus`/`resolveNextAction`). Each has its own status-badge color
logic and its own idea of what the "next action" is. A returning commissioner sees their own league list
rendered 3 times, styled 3 different ways, before reaching the bottom of the page.

## Finding 6 (real, previously flagged, still present) — redundant summary stats

The "League Operations Summary" stat row (`StatCard` × 4: Leagues Managed / Needs Setup / Missing Draft
Date / Active Now) duplicates counts already shown by `CommissionerCommandCenterOverview`'s stat chips
inside the Multi-League Overview directly above it (`totalLeagues`, `leaguesNeedingAttentionCount`,
`draftsApproachingCount`). This was already flagged as known-but-unfixed technical debt in OS-B6/OS-B7;
confirmed still present and unresolved.

## Finding 7 (real) — internal engineering language visible to customers

`CommissionerShowcasePanel.tsx`'s `shadowDecision` block renders "Shadow Only" and "Parity matched
legacy" / "Parity diff detected" directly as customer-facing text — pure internal QA/migration
terminology (shadow-mode composition testing, parity checks against a legacy system) with no meaning to
an actual commissioner.

## Finding 8 (real) — weak/misleading loading state

Every self-fetching Decision OS section (`CommissionerCommandCenterSection`, `ManagerCommandCenterSection`,
and the League Focus cards in `CommissionerHubPageClient`) initializes its snapshot state to `null` and
renders `snapshot?.field ?? 0` / `?? []` while the fetch is in flight. This means the *loading* state and
the *legitimately-empty* state are visually identical: "0 leagues need attention" during the first
~100–500ms is indistinguishable from a real all-clear. No skeleton or loading indicator exists anywhere
in this component family.

## Finding 9 (not a defect — confirmed working correctly)

`CommissionerShowcasePanel`'s AI Summary and recommendation logic were checked for fabrication (per this
phase's truthfulness mandate) — confirmed still honest post-OS-B7: `aiSummary.available` is `false` and
the UI shows "not yet available" when there are zero real health scores; all "Preview Insight" badges are
genuine, explicit, un-hidden placeholders. No new fabrication found.

## What's already good (do not rebuild)

- `DecisionOsCardPrimitives.tsx` is a sound foundation — extend it, don't replace it.
- `ManagerCommandCenterSection` / `CommissionerCommandCenterSection` and their sub-cards
  (Overview/Today's Brief/Attention Queue/Notification Center/League Switcher/Health Ranking) are
  internally consistent and already demonstrate the target visual language for the rest of the page.
- `ManagerHubPageClient.tsx` is already a clean, minimal reference for "no legacy debt."
- League Analytics, User OS, Manager DNA, and Decision Recommendations cards already use the full
  primitive suite (badge, confidence badge, evidence grid, why-panel, trust-note, empty/insufficient-data
  states) — these are the pattern to extend to everything else, not to redesign.

## Deferred (out of scope for this phase)

- Migrating the AI Prompt Cards / Migration Center grids onto shared primitives (cosmetic, lower value
  than the flagship consolidation).
- A full design pass on `/league/[id]` (League Focus) — untouched this phase.
- Renaming `CommissionerAttentionQueue` to a neutral name now that Manager OS reuses it (cosmetic,
  no behavior change, previously flagged as low-risk future cleanup in OS-C1).

## Update — Phase V1.1

Both of the above "deferred" items were picked up this phase, plus the remaining half of Finding 2:

- **Finding 2 closed**: `MissionControlCard.tsx`, `LeaguePulseCard.tsx`, `DecisionRecommendationsCard.tsx`,
  and `CommissionerAttentionQueue.tsx`'s independent tone tables are now migrated onto
  `decisionOsToneClasses`. `CommissionerAttentionQueue`'s real 5-tier severity domain (critical > high >
  medium > low > informational) doesn't fit the 4-value tone system without losing a real, currently-visible
  distinction — extended the primitives file additively with `decisionOsSeverityToneClasses` rather than
  forcing a collapse (see `DecisionOsCardPrimitives.tsx` for the documented reasoning).
- **AI Prompt Cards / Migration Center**: migrated onto semantic tokens (`decisionOsToneClasses` for
  Migration Center's status badges; `text-primary`/`text-secondary` + a readable `-600` accent shade for
  AI Prompt Cards' icon chips and "Ask Chimmy" CTA text, replacing the light `-300`/`400` pastels).
- **New Finding 10 (real, found via direct source read, same defect class as Findings 3/4)**:
  `app/league/[leagueId]/tabs/LeagueTab.tsx`'s two Decision OS launcher links ("Manager Intelligence",
  "League Intelligence") hardcoded `text-violet-100`/`text-cyan-100`/`text-*-200/60` — the identical
  light-pastel-on-light-background contrast risk pattern already found and fixed twice in Phase V1.0.
  Fixed by routing body text through `text-primary`/`text-secondary` and keeping only the icon+arrow in a
  readable, saturated accent (`violet-600`/`text-status-info`). Live pixel verification of this specific
  page was blocked by an intermittent "Loading league..." hang on cold navigation in this sandbox
  (unrelated to the fix — confirmed via direct source read that the change is a pure className swap, no
  logic touched); the equivalent token-routing pattern was verified live and correct on 3 other pages
  (Commissioner Hub hero, AI Prompt Cards, Migration Center) via `preview_eval` computed-style checks.
- Full detail in `VISUAL_OS_V1_FOUNDATION.md`'s Phase V1.1 section.

## Update — Phase V1.2

- **League Health tone systems closed**: `LeagueHealthDashboard`'s remaining 3 hand-rolled tone tables
  (`HEALTH_STATUS_CLASSES`, `ACTION_TONE_CLASSES`, `MetricTile`'s inline tone logic) are now migrated.
  `HEALTH_STATUS_CLASSES` modeled the SAME real 5-value `OverallStatus` domain
  (`excellent/healthy/watch/at_risk/critical`) that `MissionControlCard.tsx` already migrated in V1.1 —
  but with 5 genuinely DISTINCT colors (healthy=cyan vs. excellent=emerald; at_risk=orange vs.
  critical=rose), unlike `MissionControlCard`'s version where those pairs were already identical colors.
  Collapsing this one onto the 4-tone system would have silently erased a real, currently-visible
  distinction, so `DecisionOsCardPrimitives.tsx` gained a second additive extension,
  `decisionOsHealthStatusToneClasses` — same reasoning as V1.1's `decisionOsSeverityToneClasses`.
  **New finding, fixed in the same pass**: this table's original text colors (`text-emerald-300` etc.)
  were the same light-pastel contrast-risk pattern found and fixed 4 times already (Findings 3/4/10) —
  swapped to `-600` shades, borders/backgrounds unchanged (a contrast fix, not a meaning change).
  `ACTION_TONE_CLASSES` (`standard/warning/danger`) and `MetricTile` (`neutral/good/warn`) both mapped
  cleanly onto `decisionOsToneClasses` with no real domain richness lost.
- **New Finding 11 (real, deferred, not fixed)**: the Commissioner Hub empty-state CTAs use
  `text-amber-300` — the same recurring light-pastel contrast-risk pattern (Findings 3/4/10 and part of
  this update). Found incidentally while adding focus-ring support to these same buttons; NOT fixed this
  phase, since Step 3's scope was focus-ring adoption, not another contrast sweep — flagged for the next
  phase rather than silently left or silently expanded into.
- **New Finding 12 (real, verified, fixed)**: `.af-focus-ring:focus-visible` and `.af-control:focus-visible`
  (`app/globals.css`) were completely non-functional in the app's default light theme — a duplicate,
  later `:root` block redefines `--focus-ring` to an `outline`-shaped value, which is invalid syntax when
  consumed as `box-shadow` (what both classes did) and silently computes to `none`. Verified live by
  creating a real focused element and reading its computed `box-shadow` (`"none"`). Both classes had zero
  current usages, so this was a latent bug, not a live regression. Fixed by switching both to `outline`,
  matching the value shape `--focus-ring` is actually defined as today. The already-adopted, unaffected
  `.focus-ring:focus-visible` class (20+ existing usages across dashboard/referral/subscription
  components) was left completely untouched and was chosen as this phase's shared focus-ring primitive
  precisely because it was already correct and already the de facto standard — not `.af-focus-ring`.
- **Cold-navigation investigation (Finding 10's caveat, now resolved)**: root-caused via real server
  logs. Confirmed **sandbox/session-specific environmental slowness, not a code defect** — the same
  session showed 15–90 SECOND response times across many unrelated routes on many different pages
  (`/api/i18n/translations`, a static JSON lookup, took 89–90 seconds; `/api/auth/session` took 90
  seconds; `/api/subscription/entitlements` took 80 seconds), proving the slowness has nothing to do
  with League Focus's own code, data-fetch races, or Suspense boundaries. `app/league/[leagueId]/loading.tsx`
  is a standard, correctly-implemented Next.js App Router loading boundary — the "Loading league…" text
  is Next.js's own automatic fallback while the server component's `Promise.all` of 6 parallel Prisma
  queries resolves, which is itself a good, already-correct pattern. Zero code changes made. Full detail
  in `VISUAL_OS_V1_FOUNDATION.md`'s Phase V1.2 section.
- Full detail in `VISUAL_OS_V1_FOUNDATION.md`'s Phase V1.2 section.

## Update — Phase V1.3

- **Finding 11 closed**: Commissioner Hub's empty-state CTA (`text-amber-300`), flagged in V1.2 as a
  deferred finding, is now fixed (`-700`).
- **Broad contrast sweep across all named surfaces found and fixed 15 additional real instances** of the
  same recurring light-pastel pattern (Findings 3/4/10/11's defect class): Commissioner Hub's 5 Mission
  Queue icon chips, 1 snapshot-alert message, the "AI Commissioner Assistant" label + its Sparkles icon,
  the hero's 2 top badges ("Commissioner Hub", "No gambling. Pure fantasy."); League Focus's "Commish"
  member badge and `ScoringRow`'s "positive"-tone value color; `LeagueContextCard`'s real error banner
  and "Confirm Free" button; `TodaysBriefCard`'s positive-highlight badges; both Commissioner/Manager
  Command Center Section's real fetch-failure error banners (the exact "localized error state" this
  phase's own Step 4 named). All fixed the same way established since V1.0: keep the hue (meaning
  unchanged), move the TEXT shade from a light `-300`-ish pastel to a readable `-600`/`-700`/`-800`.
- **New Finding 13 (real, verified live, more severe than prior instances)**: `LeagueTab.tsx`'s
  `ScoringRow` highlighted-row label used `text-amber-50/95` — near-white text — sitting on a
  near-white `bg-[#fef9c3]/12` highlighted background. Effectively invisible. Fixed to `text-amber-800`.
  Same function's "highlighted" scoring-note text used `text-yellow-100/90` (also near-white) — fixed to
  `text-amber-700`. Both found via a widened contrast-pattern search (`-100`/`-50` shades, not just
  `-200`/`-300`) after the initial named-pattern sweep completed.
- **New Finding 14 (real, verified live, a genuinely different defect mechanism)**:
  `NotificationCenter.tsx`'s unread-count badge used `text-white` on a **solid** `bg-brand-primary`
  background (not a light tint like Findings 3/4/10 — a real, opaque, branded blue). The app's own
  light-mode accessibility guard (`html[data-mode="light"] .mode-readable [class*="text-white"] { color:
  var(--text) !important; }`, first documented in Finding 3) force-flips ANY `text-white*` class to
  near-black regardless of what it's sitting on — producing near-black text on a medium-blue background.
  Verified live via computed style: before the fix, `color: rgba(2, 6, 23, 0.92)` on `background-color:
  rgb(37, 99, 235)`; after, `color: rgb(255, 255, 255)`. Fixed by swapping to `text-content-inverse` — an
  existing, already-theme-aware semantic token (`--text-inverse`, white in light mode, near-black in dark
  mode) already used elsewhere in this exact page family (Commissioner Hub's hero CTA) for precisely this
  "text on a colored/branded background" case — and, critically, NOT matched by the guard's
  `[class*="text-white"]` selector, since its class name doesn't contain the substring "text-white".
- **`OverallStatus` visual-semantics decision — Option A, unified**: traced both `MissionControlCard.tsx`
  and `LeagueHealthDashboard`'s `overallStatus` values back to the exact same source function,
  `monitorLeagueHealth()` (confirmed via direct import-chain tracing, not assumption) — the same
  real-world fact, not two different domains that happen to share vocabulary. Per the phase's own
  "based on meaning, not implementation convenience" instruction, unified both onto the richer, 5-color
  `decisionOsHealthStatusToneClasses` (built in V1.2) — retiring `MissionControlCard`'s own lossy 4-tone
  collapse (`OVERALL_STATUS_TONE`/`overallStatusToneClasses`) rather than asking `LeagueHealthDashboard`
  to lose information to match it. This is the direction the phase's own instruction required ("Do not
  collapse five meaningful health states into fewer visibly indistinguishable states merely to reuse an
  existing helper").
- Full detail in `VISUAL_OS_V1_FOUNDATION.md`'s Phase V1.3 section.
